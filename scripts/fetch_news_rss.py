"""Bronze layer: financial news headlines from free RSS feeds.

Two kinds of feed:

  * Per-symbol — Yahoo Finance publishes an RSS feed per ticker, so a headline
    arrives already attached to the symbol it is about. This is what powers
    "click a symbol, see its news".
  * Market-wide — crypto and macro outlets publish one firehose feed. Each
    item is matched to tickers by scanning the title for known symbols and
    asset names, and is emitted once per matched ticker.

No API keys and no third-party parser: RSS is XML, and the stdlib parses XML.

Usage:
    python scripts/fetch_news_rss.py --tickers AAPL,MSFT --coins BTC,ETH
    python scripts/fetch_news_rss.py --from-gold 40
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging
import re
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import quote

# RSS bodies are untrusted network input. defusedxml blocks XXE and
# entity-expansion ("billion laughs") attacks that the stdlib parser accepts.
from defusedxml.ElementTree import fromstring as safe_fromstring

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.upload_to_hdfs import bronze_path, upload_json_lines  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

YAHOO_RSS = "https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}&region=US&lang=en-US"

# Market-wide feeds. Items are attributed to tickers by name matching.
MARKET_FEEDS = [
    ("coindesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
    ("cointelegraph", "https://cointelegraph.com/rss"),
    ("bitcoinmagazine", "https://bitcoinmagazine.com/feed"),
    ("yahoo_finance_top", "https://finance.yahoo.com/news/rssindex"),
    ("nasdaq_markets", "https://www.nasdaq.com/feed/rssoutbound?category=Markets"),
]

# Aliases used to attribute a market-wide headline to a ticker.
COIN_ALIASES = {
    "BTC": ["bitcoin", "btc"],
    "ETH": ["ethereum", "ether", "eth"],
    "SOL": ["solana", "sol"],
    "ADA": ["cardano", "ada"],
    "AVAX": ["avalanche", "avax"],
    "MATIC": ["polygon", "matic"],
    "UNI": ["uniswap"],
    "LTC": ["litecoin", "ltc"],
    "SHIB": ["shiba"],
    "DOGE": ["dogecoin", "doge"],
}

REQUEST_TIMEOUT = 20
PAUSE_SECONDS = 0.6
USER_AGENT = "BigDataProject/1.0 (student pipeline; RSS reader)"


def _text(node, *names: str) -> str:
    for name in names:
        found = node.find(name)
        if found is not None and found.text:
            return found.text.strip()
    return ""


def parse_rss(xml_text: str) -> list[dict]:
    """Extract items from an RSS 2.0 or Atom feed."""
    try:
        root = safe_fromstring(xml_text)
    except (ET.ParseError, ValueError) as exc:
        logger.warning("  unparseable feed: %s", exc)
        return []

    items: list[dict] = []
    # RSS 2.0
    for item in root.iter("item"):
        items.append(
            {
                "title": _text(item, "title"),
                "link": _text(item, "link"),
                "published": _text(item, "pubDate", "date"),
            }
        )
    # Atom
    if not items:
        ns = "{http://www.w3.org/2005/Atom}"
        for entry in root.iter(f"{ns}entry"):
            link_node = entry.find(f"{ns}link")
            items.append(
                {
                    "title": _text(entry, f"{ns}title"),
                    "link": link_node.get("href") if link_node is not None else "",
                    "published": _text(entry, f"{ns}updated", f"{ns}published"),
                }
            )
    return [i for i in items if i["title"]]


def parse_date(raw: str) -> str:
    """RFC-822 or ISO date to YYYY-MM-DD; today's date if unparseable."""
    raw = (raw or "").strip()
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return dt.datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    match = re.search(r"(\d{4}-\d{2}-\d{2})", raw)
    if match:
        return match.group(1)
    return dt.date.today().isoformat()


def fetch_feed(url: str) -> list[dict]:
    response = requests.get(url, timeout=REQUEST_TIMEOUT, headers={"User-Agent": USER_AGENT})
    response.raise_for_status()
    return parse_rss(response.text)


def normalize(ticker: str, item: dict, source: str) -> dict:
    headline = item["title"]
    date = parse_date(item.get("published", ""))
    return {
        "source": source,
        "source_type": "news",
        # Same story can be published to several feeds; the headline text is
        # part of the key so Silver's exact dedup can collapse them.
        "external_id": f"{ticker}|{date}|{headline[:80]}|{source}",
        "ticker": ticker,
        "date": date,
        "headline": headline,
        "url": item.get("link") or None,
        "publisher": source,
        "ingested_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def match_tickers(headline: str, coin_aliases: dict[str, list[str]], equities: set[str]) -> set[str]:
    """Which tickers a market-wide headline is about."""
    lowered = headline.lower()
    hits: set[str] = set()
    for ticker, aliases in coin_aliases.items():
        if any(re.search(rf"\b{re.escape(a)}\b", lowered) for a in aliases):
            hits.add(ticker)
    for symbol in equities:
        # Equity symbols are short and collide with English words, so require
        # an explicit cash-tag or parenthesised form: $AAPL or (AAPL).
        if re.search(rf"[\$\(]{re.escape(symbol)}\b", headline, re.IGNORECASE):
            hits.add(symbol)
    return hits


def tickers_from_gold(limit: int) -> list[str]:
    """Most-covered tickers in the warehouse, so news lands on symbols we hold."""
    try:
        import psycopg2
    except ImportError:
        logger.warning("psycopg2 not installed; pass --tickers instead of --from-gold")
        return []
    import os

    try:
        conn = psycopg2.connect(
            host=os.environ.get("POSTGRES_HOST_LOCAL", "localhost"),
            port=os.environ.get("POSTGRES_PORT", "5432"),
            dbname=os.environ.get("POSTGRES_DB", "gold"),
            user=os.environ.get("POSTGRES_USER", "gold"),
            password=os.environ.get("POSTGRES_PASSWORD", "gold"),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Postgres unreachable (%s); pass --tickers instead", exc)
        return []
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ticker FROM gold.daily_prices GROUP BY ticker "
                "ORDER BY COUNT(*) DESC LIMIT %s",
                (limit,),
            )
            return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest financial news RSS into Bronze.")
    parser.add_argument("--tickers", default=None, help="Comma-separated equity tickers for per-symbol feeds.")
    parser.add_argument("--coins", default=None, help="Comma-separated coin tickers to match in market feeds.")
    parser.add_argument("--from-gold", type=int, default=0, help="Pull the N best-covered tickers from Gold.")
    parser.add_argument("--date", default=dt.date.today().isoformat(), help="Bronze partition date.")
    parser.add_argument("--skip-market", action="store_true", help="Skip the market-wide feeds.")
    args = parser.parse_args()

    equities: list[str] = []
    if args.tickers:
        equities = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    elif args.from_gold:
        equities = tickers_from_gold(args.from_gold)

    coins = (
        {c.strip().upper(): COIN_ALIASES.get(c.strip().upper(), [c.strip().lower()])
         for c in args.coins.split(",") if c.strip()}
        if args.coins
        else COIN_ALIASES
    )

    records: list[dict] = []
    seen: set[str] = set()

    def add(record: dict) -> None:
        if record["external_id"] in seen:
            return
        seen.add(record["external_id"])
        records.append(record)

    # Per-symbol feeds.
    for i, symbol in enumerate(equities):
        try:
            items = fetch_feed(YAHOO_RSS.format(symbol=quote(symbol)))
            for item in items:
                add(normalize(symbol, item, "yahoo_finance"))
            logger.info("  %s: %d headlines", symbol, len(items))
        except Exception as exc:  # noqa: BLE001
            logger.warning("  %s failed: %s", symbol, exc)
        if i < len(equities) - 1:
            time.sleep(PAUSE_SECONDS)

    # Market-wide feeds, attributed by name matching.
    if not args.skip_market:
        equity_set = set(equities)
        for name, url in MARKET_FEEDS:
            try:
                items = fetch_feed(url)
                matched = 0
                for item in items:
                    for ticker in match_tickers(item["title"], coins, equity_set):
                        add(normalize(ticker, item, name))
                        matched += 1
                logger.info("  %s: %d items, %d ticker matches", name, len(items), matched)
            except Exception as exc:  # noqa: BLE001
                logger.warning("  %s failed: %s", name, exc)
            time.sleep(PAUSE_SECONDS)

    if not records:
        logger.error("No news records fetched.")
        return 1

    target = bronze_path("news_rss", args.date, "headlines.jsonl")
    started = time.time()
    count = upload_json_lines(iter(records), target)
    logger.info("Bronze news_rss done: %d records at %s", count, target)

    try:
        from scripts.fetch_stocks import push_bronze_metrics

        push_bronze_metrics("news_rss", count, time.time() - started)
    except Exception:  # noqa: BLE001
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

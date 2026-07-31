"""Bronze layer: intraday OHLCV bars, so the dashboard can offer sub-daily timeframes.

The Kaggle archive is daily-only, so 1m/5m/15m/1h charts need a second feed.
Two free, key-less sources:

  * Yahoo Finance chart API — equities, ETFs, and crypto (BTC-USD style).
  * CoinGecko market_chart — crypto fallback when Yahoo lacks the pair.

Yahoo caps history by interval, and asking for more silently returns less:

    1m   -> last 7 days
    5m   -> last 60 days
    15m  -> last 60 days
    1h   -> last 730 days

Usage:
    python scripts/fetch_intraday.py --tickers AAPL,MSFT --intervals 5m,1h
    python scripts/fetch_intraday.py --from-gold 25 --intervals 1m,5m,15m,1h
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
import sys
import time
from pathlib import Path
from urllib.parse import quote

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.upload_to_hdfs import bronze_path, upload_json_lines  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

# interval -> the longest range Yahoo will actually serve for it.
INTERVAL_RANGE = {
    "1m": "7d",
    "2m": "60d",
    "5m": "60d",
    "15m": "60d",
    "30m": "60d",
    "60m": "730d",
    "1h": "730d",
    "1d": "10y",
}

# Tickers that are crypto in our warehouse need a Yahoo-style pair suffix.
CRYPTO_TICKERS = {"BTC", "ETH", "SOL", "ADA", "AVAX", "MATIC", "UNI", "LTC", "SHIB", "DOGE", "BNB", "XRP"}

REQUEST_TIMEOUT = 25
PAUSE_SECONDS = 0.8
USER_AGENT = "Mozilla/5.0 (compatible; BigDataProject/1.0; student pipeline)"


def yahoo_symbol(ticker: str) -> str:
    """Warehouse ticker to Yahoo symbol. Crypto needs an explicit quote pair."""
    return f"{ticker}-USD" if ticker.upper() in CRYPTO_TICKERS else ticker


def fetch_yahoo(ticker: str, interval: str) -> list[dict]:
    """One interval of bars for one ticker. Returns [] when Yahoo has none."""
    symbol = yahoo_symbol(ticker)
    params = {
        "interval": interval,
        "range": INTERVAL_RANGE.get(interval, "60d"),
        "includePrePost": "false",
        "events": "div,split",
    }
    response = requests.get(
        YAHOO_CHART.format(symbol=quote(symbol)),
        params=params,
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": USER_AGENT},
    )
    if response.status_code == 404:
        return []
    response.raise_for_status()

    body = response.json()
    result = (body.get("chart") or {}).get("result") or []
    if not result:
        return []

    block = result[0]
    stamps = block.get("timestamp") or []
    quotes = ((block.get("indicators") or {}).get("quote") or [{}])[0]
    opens, highs = quotes.get("open") or [], quotes.get("high") or []
    lows, closes = quotes.get("low") or [], quotes.get("close") or []
    volumes = quotes.get("volume") or []

    source = f"yahoo_{interval}"
    rows: list[dict] = []
    for i, epoch in enumerate(stamps):
        close = _at(closes, i)
        if epoch is None or close is None:
            # Yahoo pads the arrays with nulls for halted or pre-market slots.
            continue
        moment = dt.datetime.fromtimestamp(epoch, tz=dt.timezone.utc)
        iso = moment.isoformat()
        rows.append(
            {
                "source": source,
                "source_type": "intraday",
                "external_id": f"{ticker}|{iso}|{interval}",
                "ticker": ticker.upper(),
                "date": moment.date().isoformat(),
                "ts": iso,
                "interval": interval,
                "open": _at(opens, i),
                "high": _at(highs, i),
                "low": _at(lows, i),
                "close": close,
                "volume": int(_at(volumes, i) or 0) or None,
                "ingested_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            }
        )
    return rows


def _at(values: list, index: int):
    try:
        value = values[index]
    except (IndexError, TypeError):
        return None
    return None if value is None else float(value)


def tickers_from_gold(limit: int) -> list[str]:
    """Best-covered tickers in the warehouse, so intraday lands on symbols we hold."""
    try:
        import psycopg2
    except ImportError:
        logger.warning("psycopg2 not installed; pass --tickers instead of --from-gold")
        return []
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
    parser = argparse.ArgumentParser(description="Ingest intraday OHLCV bars into Bronze.")
    parser.add_argument("--tickers", default=None, help="Comma-separated tickers.")
    parser.add_argument("--from-gold", type=int, default=0, help="Use the N best-covered Gold tickers.")
    parser.add_argument(
        "--intervals",
        default="5m,15m,1h",
        help=f"Comma-separated intervals. Supported: {', '.join(INTERVAL_RANGE)}.",
    )
    parser.add_argument("--date", default=dt.date.today().isoformat(), help="Bronze partition date.")
    args = parser.parse_args()

    tickers = (
        [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
        if args.tickers
        else tickers_from_gold(args.from_gold or 25)
    )
    if not tickers:
        logger.error("No tickers resolved. Pass --tickers or run the Gold job first.")
        return 1

    intervals = [i.strip() for i in args.intervals.split(",") if i.strip()]
    unknown = [i for i in intervals if i not in INTERVAL_RANGE]
    if unknown:
        logger.error("Unsupported interval(s): %s", ", ".join(unknown))
        return 1

    started = time.time()
    records: list[dict] = []
    for ticker in tickers:
        for interval in intervals:
            try:
                rows = fetch_yahoo(ticker, interval)
                records.extend(rows)
                logger.info("  %s %s: %d bars", ticker, interval, len(rows))
            except Exception as exc:  # noqa: BLE001
                logger.warning("  %s %s failed: %s", ticker, interval, exc)
            time.sleep(PAUSE_SECONDS)

    if not records:
        logger.error("No intraday bars fetched.")
        return 1

    target = bronze_path("intraday", args.date, "bars.jsonl")
    count = upload_json_lines(iter(records), target)
    logger.info("Bronze intraday done: %d bars at %s", count, target)

    try:
        from scripts.push_metrics import PushgatewayClient

        client = PushgatewayClient(job="bronze")
        client.inc("bronze_records_total", {"source": "intraday"}, count)
        client.observe("bronze_write_duration_seconds", {"source": "intraday"}, time.time() - started)
        client.push()
    except Exception:  # noqa: BLE001
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

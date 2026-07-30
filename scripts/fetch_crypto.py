"""Bronze layer: ingest crypto OHLCV + news headlines from CryptoDataDownload-style CSV files.

Each file like data/BTC.csv has columns:
  ,begins_at,open_price,close_price,high_price,low_price,symbol,articles

`articles` is a stringified JSON list of headline strings. We split each
CSV row into:
  - one OHLCV record (source_type = crypto_ohlcv, close only since this format lacks volume)
  - one news headline record per item in the articles array

Usage:
    python scripts/fetch_crypto.py --coins BTC,ETH,SOL
    python scripts/fetch_crypto.py --folder data
"""

from __future__ import annotations

import argparse
import ast
import datetime as dt
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.upload_to_hdfs import bronze_path, ensure_directory, upload_json_lines  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_FOLDER = "data"


def ticker_from_filename(path: Path) -> str:
    return path.stem.upper()


def safe_parse_articles(raw) -> list[str]:
    """Articles column is a stringified list. ast.literal_eval handles it safely."""
    if not raw or raw == "" or raw == "[]":
        return []
    try:
        items = ast.literal_eval(raw)
        if isinstance(items, list):
            return [str(x).strip() for x in items if str(x).strip()]
    except (ValueError, SyntaxError):
        pass
    # Fallback: try to extract headlines with a regex
    import re
    matches = re.findall(r"'([^']{20,})'", str(raw))
    return [m for m in matches]


def normalize_ohlcv_row(row: dict, ticker: str, source: str) -> dict:
    return {
        "source": source,
        "source_type": "crypto_ohlcv",
        "external_id": f"{ticker}|{row.get('begins_at')}|{source}",
        "ticker": ticker,
        "date": row.get("begins_at"),
        "open": _safe_float(row.get("open_price")),
        "high": _safe_float(row.get("high_price")),
        "low": _safe_float(row.get("low_price")),
        "close": _safe_float(row.get("close_price")),
        "volume": None,  # CryptoDataDownload format lacks volume for crypto
        "ingested_at": dt.datetime.utcnow().isoformat(),
    }


def normalize_news_row(ticker: str, headline: str, date: str, source: str) -> dict:
    return {
        "source": source,
        "source_type": "crypto_news",
        "external_id": f"{ticker}|{date}|{headline[:60]}|{source}",
        "ticker": ticker,
        "date": date,
        "headline": headline,
        "url": None,
        "publisher": source,
        "ingested_at": dt.datetime.utcnow().isoformat(),
    }


def _safe_float(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def stream_csv(path: Path):
    import csv as csvlib

    with open(path, "rt", encoding="utf-8") as f:
        # CryptoDataDownload CSVs have an unnamed index column.
        reader = csvlib.DictReader(f)
        for row in reader:
            yield row


def collect_files(folder: Path, coins: set[str] | None) -> list[Path]:
    found: list[Path] = []
    for path in sorted(folder.glob("*.csv")):
        # Skip non-crypto files like stocks_etfs.csv
        if not path.stem.isupper() or len(path.stem) > 6:
            continue
        ticker = path.stem.upper()
        if coins and ticker not in coins:
            continue
        found.append(path)
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest crypto OHLCV + news into Bronze HDFS.")
    parser.add_argument("--folder", default=DEFAULT_FOLDER, help="Folder to scan for crypto CSVs.")
    parser.add_argument("--coins", default=None, help="Comma-separated list of coins to include (default: all).")
    parser.add_argument("--ohlcv-date", default=dt.date.today().isoformat(), help="OHLCV partition date.")
    parser.add_argument("--news-date", default=dt.date.today().isoformat(), help="News partition date.")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(message)s")

    folder = Path(args.folder)
    if not folder.exists():
        logger.error("Folder does not exist: %s", folder)
        return 1

    coins: set[str] | None = None
    if args.coins:
        coins = {c.strip().upper() for c in args.coins.split(",") if c.strip()}

    files = collect_files(folder, coins)
    if not files:
        logger.error("No matching crypto CSV files found in %s", folder)
        return 1
    logger.info("Found %d crypto CSV files", len(files))

    ohlcv_target = bronze_path("crypto_bulk", args.ohlcv_date, "ohlcv.jsonl")
    news_target = bronze_path("crypto_news", args.news_date, "headlines.jsonl")
    ensure_directory(f"/data/bronze/crypto_bulk/{args.ohlcv_date}")
    ensure_directory(f"/data/bronze/crypto_news/{args.news_date}")

    def ohlcv_rows():
        for path in files:
            ticker = ticker_from_filename(path)
            source = f"cryptodatadownload_{ticker.lower()}"
            for row in stream_csv(path):
                normalized = {k.lower(): v for k, v in row.items() if k}
                yield normalize_ohlcv_row(normalized, ticker, source)
            logger.info("  %s: OHLCV parsed", path.name)

    def news_rows():
        for path in files:
            ticker = ticker_from_filename(path)
            source = f"cryptodatadownload_{ticker.lower()}"
            for row in stream_csv(path):
                normalized = {k.lower(): v for k, v in row.items() if k}
                date = normalized.get("begins_at")
                for headline in safe_parse_articles(normalized.get("articles")):
                    yield normalize_news_row(ticker, headline, date, source)
            logger.info("  %s: headlines parsed", path.name)

    # Two separate Bronze partitions, one per source_type. The Silver job and
    # the dashboard both address these by path, so they must not be merged.
    ohlcv_count = upload_json_lines(ohlcv_rows(), ohlcv_target)
    logger.info("Bronze crypto_bulk done: %d records at %s", ohlcv_count, ohlcv_target)
    news_count = upload_json_lines(news_rows(), news_target)
    logger.info("Bronze crypto_news done: %d records at %s", news_count, news_target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

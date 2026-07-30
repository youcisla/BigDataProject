"""Bronze layer: ingest US stocks + ETFs OHLCV from CryptoDataDownload-style archives.

Reads every *.us.txt file under data/Stocks/ and data/ETFs/. Each file is
a CSV with header `Date,Open,High,Low,Close,Volume,OpenInt` (one row per
trading day, ticker encoded in the filename like A.US.TXT -> A).

Usage:
    python scripts/fetch_stocks.py --tickers AAPL,MSFT,GOOG
    python scripts/fetch_stocks.py --tickers-file data/tickers.txt
    python scripts/fetch_stocks.py --folder data/Stocks data/ETFs
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.upload_to_hdfs import bronze_path, ensure_directory, upload_json_lines  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_FOLDERS = ["data/Stocks", "data/ETFs"]


def ticker_from_filename(path: Path) -> str:
    """A.US.TXT -> A. AAPL.US.TXT -> AAPL. Maps to uppercase ticker."""
    return path.stem.split(".")[0].upper()


def normalize_row(row: dict, ticker: str, source: str) -> dict:
    return {
        "source": source,
        "source_type": "stock_ohlcv",
        "external_id": f"{ticker}|{row.get('Date')}|{source}",
        "ticker": ticker,
        "date": row.get("Date"),
        "open": _safe_float(row.get("Open")),
        "high": _safe_float(row.get("High")),
        "low": _safe_float(row.get("Low")),
        "close": _safe_float(row.get("Close")),
        "volume": _safe_int(row.get("Volume")),
        "ingested_at": dt.datetime.utcnow().isoformat(),
    }


def _safe_float(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def stream_csv(path: Path, ticker: str, source: str):
    import csv as csvlib

    with open(path, "rt", encoding="utf-8") as f:
        reader = csvlib.DictReader(f)
        for row in reader:
            yield normalize_row(row, ticker, source)


def collect_files(folders: list[str], tickers: set[str] | None) -> list[tuple[Path, str, str]]:
    """Find all ticker files in the given folders, optionally filtered by ticker."""
    found: list[tuple[Path, str, str]] = []
    for folder in folders:
        p = Path(folder)
        if not p.exists():
            logger.warning("Folder does not exist: %s", p)
            continue
        for path in sorted(p.glob("*.us.txt")):
            ticker = ticker_from_filename(path)
            if tickers and ticker not in tickers:
                continue
            label = "etf" if "etf" in str(path).lower() else "stock"
            found.append((path, ticker, f"cryptodatadownload_{label}"))
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest US stocks + ETFs OHLCV into Bronze HDFS.")
    parser.add_argument("--folder", action="append", help="Folder(s) to scan (default: data/Stocks data/ETFs).")
    parser.add_argument("--tickers", default=None, help="Comma-separated list of tickers to include (default: all).")
    parser.add_argument("--tickers-file", default=None, help="File with one ticker per line to include.")
    parser.add_argument("--date", default=dt.date.today().isoformat(), help="Partition date.")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(message)s")

    tickers: set[str] | None = None
    if args.tickers:
        tickers = {t.strip().upper() for t in args.tickers.split(",") if t.strip()}
    elif args.tickers_file and os.path.exists(args.tickers_file):
        with open(args.tickers_file, "rt", encoding="utf-8") as f:
            tickers = {line.strip().upper() for line in f if line.strip()}

    folders = args.folder or DEFAULT_FOLDERS
    files = collect_files(folders, tickers)
    if not files:
        logger.error("No matching files found in %s", folders)
        return 1
    if tickers:
        logger.info("Found %d files for %d tickers", len(files), len(tickers))
    else:
        logger.info("Found %d files (all tickers)", len(files))

    target = bronze_path("stocks", args.date, "ohlcv.jsonl")
    ensure_directory(f"/data/bronze/stocks/{args.date}")

    def all_rows():
        total = 0
        for path, ticker, source in files:
            n = 0
            for row in stream_csv(path, ticker, source):
                yield row
                n += 1
            total += n
            logger.info("  %s (%s): %d rows", path.name, ticker, n)
        logger.info("Total rows: %d", total)

    count = upload_json_lines(all_rows(), target)
    logger.info("Bronze stocks done: %d records at %s", count, target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

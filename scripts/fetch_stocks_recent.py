"""Bronze layer: ingest the most-recent N stock/ETF files from the Kaggle archive.

The full archive is ~16M rows and Silver takes ~13 minutes on the dev
worker. For a fast end-to-end turnaround, ingest just the freshest files
by mtime — those cover the most-traded symbols (AAPL, MSFT, TSLA, GOOGL,
AMZN, NVDA, META, ...) at the cost of skipping the long tail.

Approximates a *latest-records* slice without having to read each file and
sort its tail rows. The mtime correlates with download order, which
correlates with author interest, which correlates with how active the
symbol is.

Usage:
    python scripts/fetch_stocks_recent.py --records 1000000
    python scripts/fetch_stocks_recent.py --tickers 100                # at most N newest files
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.upload_to_hdfs import upload_json_lines  # noqa: E402
from scripts.fetch_stocks import ticker_from_filename, stream_csv  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def newest_files(folders: list[Path], limit: int) -> list[Path]:
    """Newest file across the folders, by mtime, capped at `limit`."""
    files: list[Path] = []
    for folder in folders:
        if not folder.exists():
            continue
        files.extend(folder.glob("*.us.txt"))
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return files[:limit]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Ingest the freshest stock/ETF files from the Kaggle archive."
    )
    parser.add_argument(
        "--records",
        type=int,
        default=1_000_000,
        help="Approximate upper bound on rows to ingest. Default: 1,000,000.",
    )
    parser.add_argument(
        "--tickers",
        type=int,
        default=None,
        help="Cap the number of files instead of rows. Default: derived from --records.",
    )
    args = parser.parse_args()

    folders = [Path("data/Stocks"), Path("data/ETFs")]
    # Pick by ticker count when not specified — each Stock file is ~3,200 rows
    # of daily OHLCV; an ETF is similar.
    ticker_limit = args.tickers or max(50, args.records // 3000)
    paths = newest_files(folders, ticker_limit)
    if not paths:
        logger.error("No files found in data/Stocks or data/ETFs.")
        return 1
    logger.info("Reading %d newest files (~%.0f MB across %d files)",
                len(paths), sum(p.stat().st_size for p in paths) / 1e6, len(paths))

    started = time.time()
    total = 0

    def rows():
        nonlocal_total = total
        for path in paths:
            ticker = ticker_from_filename(path)
            source = f"cryptodatadownload_{'etf' if 'ETFs' in str(path) else 'stock'}"
            try:
                # stream_csv yields normalized rows when called with ticker/source
                for row in stream_csv(path, ticker, source):
                    yield row
                    nonlocal_total += 1
                    if nonlocal_total >= args.records:
                        return
            except FileNotFoundError:
                logger.warning("skip %s (file vanished)", path.name)
                continue

    # Local-first write — same fallback fetch_stocks.py uses.
    from scripts.upload_to_hdfs import bronze_path  # noqa: E402

    target = bronze_path("stocks", dt.date.today().isoformat(), "ohlcv.jsonl")
    count = upload_json_lines(rows(), target)
    total = count

    elapsed = time.time() - started
    logger.info("Bronze stocks done: %d records at %s (%.1fs)", count, target, elapsed)

    try:
        from scripts.push_metrics import PushgatewayClient
        from scripts.fetch_stocks import push_bronze_metrics

        push_bronze_metrics("stocks", count, elapsed)
    except Exception:  # noqa: BLE001
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

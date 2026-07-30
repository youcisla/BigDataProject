"""Pipeline entry point.

Orchestrates Bronze, Silver, and Gold layers. Each layer is a separate
job that can also be run standalone:

    python main.py --layer bronze
    python main.py --layer silver
    python main.py --layer gold
    python main.py --layer all
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent


def run_bronze(args) -> int:
    """Run Bronze ingestion: stocks/ETF OHLCV + crypto OHLCV & headlines → HDFS."""
    logger.info("=== Bronze layer ===")
    env = os.environ.copy()
    if args.date:
        env["BRONZE_DATE"] = args.date

    if not args.skip_stocks:
        cmd = [sys.executable, "scripts/fetch_stocks.py", "--date", args.date]
        for folder in args.stocks_folder:
            cmd += ["--folder", folder]
        if args.tickers_file:
            cmd += ["--tickers-file", args.tickers_file]
        logger.info("Running: %s", " ".join(cmd))
        result = subprocess.run(cmd, cwd=PROJECT_ROOT, env=env)
        if result.returncode != 0:
            return result.returncode

    if not args.skip_crypto:
        cmd = [
            sys.executable,
            "scripts/fetch_crypto.py",
            "--folder",
            args.crypto_folder,
            "--ohlcv-date",
            args.date,
            "--news-date",
            args.date,
        ]
        logger.info("Running: %s", " ".join(cmd))
        result = subprocess.run(cmd, cwd=PROJECT_ROOT, env=env)
        if result.returncode != 0:
            return result.returncode

    return 0


def run_silver(args) -> int:
    """Run Silver transformation: HDFS Bronze JSON → HDFS Silver Parquet."""
    logger.info("=== Silver layer ===")
    cmd = [
        "docker",
        "compose",
        "exec",
        "-T",
        "spark-master",
        "spark-submit",
        "--master",
        "spark://spark-master:7077",
        "--deploy-mode",
        "client",
        "/opt/spark/jobs/silver_transform.py",
    ]
    if args.date:
        cmd += ["--date", args.date]
    logger.info("Running: %s", " ".join(cmd))
    return subprocess.run(cmd, cwd=PROJECT_ROOT).returncode


def run_gold(args) -> int:
    """Run Gold aggregation: HDFS Silver Parquet → Postgres KPIs."""
    logger.info("=== Gold layer ===")
    cmd = [
        "docker",
        "compose",
        "exec",
        "-T",
        "spark-master",
        "spark-submit",
        "--master",
        "spark://spark-master:7077",
        "--deploy-mode",
        "client",
        "--packages",
        "org.postgresql:postgresql:42.7.3",
        "/opt/spark/jobs/gold_kpis.py",
    ]
    if args.date:
        cmd += ["--date", args.date]
    logger.info("Running: %s", " ".join(cmd))
    return subprocess.run(cmd, cwd=PROJECT_ROOT).returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Big Data pipeline entry point.")
    parser.add_argument(
        "--layer",
        choices=("bronze", "silver", "gold", "all"),
        default="all",
        help="Which layer to run. Default: all.",
    )
    parser.add_argument(
        "--date",
        default=dt.date.today().isoformat(),
        help="Partition date (YYYY-MM-DD). Defaults to today UTC.",
    )
    parser.add_argument(
        "--stocks-folder",
        action="append",
        default=None,
        help="Folder(s) holding *.us.txt OHLCV files. Repeatable. Default: data/Stocks data/ETFs.",
    )
    parser.add_argument(
        "--crypto-folder",
        default="data",
        help="Folder holding per-coin CryptoDataDownload CSVs. Default: data.",
    )
    parser.add_argument(
        "--tickers-file",
        default=os.environ.get("TICKERS_FILE"),
        help="File with one ticker per line, to restrict stock ingestion.",
    )
    parser.add_argument("--skip-stocks", action="store_true", help="Skip stock/ETF ingestion.")
    parser.add_argument("--skip-crypto", action="store_true", help="Skip crypto OHLCV + news ingestion.")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()
    if not args.stocks_folder:
        args.stocks_folder = ["data/Stocks", "data/ETFs"]

    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(message)s")

    rc = 0
    if args.layer in ("bronze", "all"):
        rc = run_bronze(args)
        if rc != 0:
            return rc
    if args.layer in ("silver", "all"):
        rc = run_silver(args)
        if rc != 0:
            return rc
    if args.layer in ("gold", "all"):
        rc = run_gold(args)
        if rc != 0:
            return rc

    logger.info("Pipeline complete.")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())

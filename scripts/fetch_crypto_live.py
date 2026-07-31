"""Bronze layer: pull live crypto OHLC from the CoinGecko public API.

Covers the "automated fetch via API" requirement. The archive loaders
(fetch_stocks.py, fetch_crypto.py) provide volume; this provides a
recurring live feed that can be driven by cron.

CoinGecko's free tier needs no API key (10-30 calls/min). Each coin costs
one call, so the default coin list stays well inside the limit.

Usage:
    python scripts/fetch_crypto_live.py
    python scripts/fetch_crypto_live.py --coins bitcoin,ethereum --days 30
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.upload_to_hdfs import bronze_path, upload_json_lines  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

API = "https://api.coingecko.com/api/v3"
SOURCE = "coingecko"

# CoinGecko ids mapped to the ticker symbols the rest of the pipeline uses.
DEFAULT_COINS = {
    "bitcoin": "BTC",
    "ethereum": "ETH",
    "solana": "SOL",
    "cardano": "ADA",
    "avalanche-2": "AVAX",
    "litecoin": "LTC",
}

# Free tier allows 10-30 calls/min; one call per coin with a pause between.
REQUEST_PAUSE_SECONDS = 3.0
REQUEST_TIMEOUT = 30


def fetch_ohlc(coin_id: str, days: int) -> list[list[float]]:
    """Return [[ts_ms, open, high, low, close], ...] for one coin."""
    url = f"{API}/coins/{coin_id}/ohlc"
    response = requests.get(
        url, params={"vs_currency": "usd", "days": str(days)}, timeout=REQUEST_TIMEOUT
    )
    response.raise_for_status()
    return response.json()


def normalize(candle: list[float], ticker: str) -> dict:
    ts_ms, open_, high, low, close = candle[:5]
    date = dt.datetime.fromtimestamp(ts_ms / 1000, tz=dt.timezone.utc).date().isoformat()
    return {
        "source": SOURCE,
        "source_type": "crypto_ohlcv",
        "external_id": f"{ticker}|{date}|{SOURCE}",
        "ticker": ticker,
        "date": date,
        "open": float(open_),
        "high": float(high),
        "low": float(low),
        "close": float(close),
        # CoinGecko's OHLC endpoint does not carry volume.
        "volume": None,
        "ingested_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def push_bronze_metrics(source: str, records: int, duration: float) -> None:
    """Emit Bronze counters to the Pushgateway. Best-effort: never fails the ingest."""
    try:
        from scripts.push_metrics import PushgatewayClient
    except ImportError:
        return
    client = PushgatewayClient(job="bronze")
    client.observe("bronze_records_total", labels={"source": source}, value=records)
    client.observe("bronze_write_duration_seconds", labels={"source": source}, value=duration)
    client.push()


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest live crypto OHLC from CoinGecko into Bronze.")
    parser.add_argument(
        "--coins",
        default=None,
        help="Comma-separated CoinGecko ids (default: bitcoin,ethereum,solana,cardano,avalanche-2,litecoin).",
    )
    parser.add_argument("--days", type=int, default=90, help="Days of history per coin. Default: 90.")
    parser.add_argument("--date", default=dt.date.today().isoformat(), help="Bronze partition date.")
    args = parser.parse_args()

    coins = DEFAULT_COINS
    if args.coins:
        ids = [c.strip() for c in args.coins.split(",") if c.strip()]
        # Fall back to the uppercased id when we have no explicit ticker mapping.
        coins = {i: DEFAULT_COINS.get(i, i.upper()) for i in ids}

    records: list[dict] = []
    failed: list[str] = []
    for i, (coin_id, ticker) in enumerate(coins.items()):
        try:
            candles = fetch_ohlc(coin_id, args.days)
            records.extend(normalize(c, ticker) for c in candles)
            logger.info("  %s (%s): %d candles", coin_id, ticker, len(candles))
        except Exception as exc:  # noqa: BLE001
            # One rate-limited coin must not lose the whole batch.
            logger.warning("  %s failed: %s", coin_id, exc)
            failed.append(coin_id)
        if i < len(coins) - 1:
            time.sleep(REQUEST_PAUSE_SECONDS)

    if not records:
        logger.error("No records fetched from CoinGecko (all %d coins failed).", len(coins))
        return 1

    target = bronze_path("crypto_live", args.date, "ohlc.jsonl")
    started = time.time()
    count = upload_json_lines(iter(records), target)
    logger.info("Bronze crypto_live done: %d records at %s", count, target)
    push_bronze_metrics("crypto_live", count, time.time() - started)
    if failed:
        logger.warning("Coins that failed: %s", ", ".join(failed))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

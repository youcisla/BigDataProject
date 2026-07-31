"""Push the real per-table row counts of the Gold warehouse to pushgateway.

The pipeline's per-run push is a *counter increment*, so a missed push
silently undercounts the dashboard. This script reads the actual row
counts from Postgres and pushes them as gauge values: from then on every
Prometheus query reads truth.

Usage:
    python scripts/reconcile_metrics.py
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2  # noqa: E402

from scripts.push_metrics import PushgatewayClient  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Tables the dashboard queries. Hard-coded so the metric labels match the
# Grafana panel groupings one-to-one, and so a typo in the schema doesn't
# silently pollute the dashboard with an empty label.
GOLD_TABLES = [
    "daily_prices",
    "daily_returns",
    "top_movers",
    "rolling_volatility_7d",
    "news_volume_per_coin",
    "news_headlines",
    "news_sentiment_daily",
    "intraday_prices",
    "silver_sample",
]


def main() -> int:
    try:
        conn = psycopg2.connect(
            host=os.environ.get("POSTGRES_HOST_LOCAL", "localhost"),
            port=os.environ.get("POSTGRES_PORT", "5432"),
            dbname=os.environ.get("POSTGRES_DB", "gold"),
            user=os.environ.get("POSTGRES_USER", "gold"),
            password=os.environ.get("POSTGRES_PASSWORD", "gold"),
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Postgres unreachable (%s)", exc)
        return 1

    client = PushgatewayClient(job="gold")
    pushed = 0
    try:
        with conn.cursor() as cur:
            for t in GOLD_TABLES:
                try:
                    cur.execute(f"SELECT COUNT(*) FROM gold.{t}")
                    count = cur.fetchone()[0]
                except Exception as exc:  # noqa: BLE001
                    # Table doesn't exist yet on a fresh deployment — skip.
                    logger.warning("skip %s (%s)", t, exc)
                    conn.rollback()
                    continue
                client.observe("gold_rows_loaded_total", labels={"table": t}, value=count)
                pushed += 1

        if client.push():
            logger.info("Pushed %d Gold table counts to pushgateway", pushed)
            return 0
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())

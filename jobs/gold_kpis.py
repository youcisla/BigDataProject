"""Gold layer: Silver Parquet → Postgres KPIs.

Reads /data/silver/data (Parquet, partitioned by source_type + date),
computes:
  - daily_prices : OHLCV per ticker per day
  - daily_returns : pct change vs prev trading day, per ticker
  - top_movers : top 10 gainers + losers per day
  - rolling_volatility_7d : 7-day rolling stddev of returns per ticker
  - news_volume_per_coin : daily headline counts per ticker

Writes via JDBC to Postgres schema `gold`.

Run via spark-submit inside spark-master container:
    docker compose exec spark-master spark-submit \\
        --master spark://spark-master:7077 \\
        --deploy-mode client \\
        --packages org.postgresql:postgresql:42.7.3 \\
        /opt/spark/jobs/gold_kpis.py
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import sys
import time
from typing import Iterable

from pyspark.sql import SparkSession, functions as F, types as T, Window
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SILVER_BASE = "hdfs://namenode:9000/data/silver/data"

PG_HOST = os.environ.get("POSTGRES_HOST", "postgres")
PG_PORT = os.environ.get("POSTGRES_PORT", "5432")
PG_DB = os.environ.get("POSTGRES_DB", "gold")
PG_USER = os.environ.get("POSTGRES_USER", "gold")
PG_PASS = os.environ.get("POSTGRES_PASSWORD", "gold")
PG_URL = f"jdbc:postgresql://{PG_HOST}:{PG_PORT}/{PG_DB}"


def build_spark() -> SparkSession:
    return (
        SparkSession.builder.appName("gold_kpis")
        .master("spark://spark-master:7077")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.shuffle.partitions", "4")
        .getOrCreate()
    )


def read_silver(spark: SparkSession):
    return spark.read.parquet(SILVER_BASE)


def write_postgres(df, table: str, mode: str = "append") -> None:
    # Cast date column to DATE so Postgres accepts it (Silver stores dates as strings)
    casted = df.withColumn("date", F.col("date").cast("date"))
    (
        casted.write.format("jdbc")
        .option("url", PG_URL)
        .option("dbtable", table)
        .option("user", PG_USER)
        .option("password", PG_PASS)
        .option("driver", "org.postgresql.Driver")
        .mode(mode)
        .save()
    )


def compute_daily_prices(silver):
    """Latest close per (date, ticker, source)."""
    return (
        silver.filter(F.col("source_type") != F.lit("crypto_news"))
        .filter(F.col("close").isNotNull())
        .groupBy("date", "ticker", "source")
        .agg(F.first("open").alias("open"),
             F.max("high").alias("high"),
             F.min("low").alias("low"),
             F.first("close").alias("close"),
             F.sum("volume").alias("volume"))
        .withColumn("updated_at", F.current_timestamp())
        .select("date", "ticker", "source", "open", "high", "low", "close", "volume", "updated_at")
    )


def compute_daily_returns(daily_prices):
    """Per-ticker pct change vs previous trading day."""
    w = Window.partitionBy("ticker").orderBy("date")
    prev = F.lag("close").over(w)
    return (
        daily_prices.withColumn("prev_close", prev)
        .filter(F.col("prev_close").isNotNull())
        .withColumn("return_pct", ((F.col("close") - F.col("prev_close")) / F.col("prev_close")) * F.lit(100))
        .withColumn("updated_at", F.current_timestamp())
        .select("date", "ticker", "return_pct", "updated_at")
    )


def compute_top_movers(daily_returns):
    """Top 10 gainers + losers per day."""
    w_gain = Window.partitionBy("date").orderBy(F.col("return_pct").desc())
    w_loss = Window.partitionBy("date").orderBy(F.col("return_pct").asc())
    gainers = (
        daily_returns.withColumn("rank", F.row_number().over(w_gain))
        .filter(F.col("rank") <= 10)
        .withColumn("direction", F.lit("gain"))
        .withColumn("updated_at", F.current_timestamp())
        .select("date", "ticker", "direction", "rank", "return_pct", "updated_at")
    )
    losers = (
        daily_returns.withColumn("rank", F.row_number().over(w_loss))
        .filter(F.col("rank") <= 10)
        .withColumn("direction", F.lit("loss"))
        .withColumn("updated_at", F.current_timestamp())
        .select("date", "ticker", "direction", "rank", "return_pct", "updated_at")
    )
    return gainers.unionByName(losers)


def compute_rolling_volatility_7d(daily_returns):
    """7-day rolling stddev of returns per ticker."""
    w = (
        Window.partitionBy("ticker")
        .orderBy("date")
        .rowsBetween(-6, 0)
    )
    return (
        daily_returns.withColumn("volatility", F.stddev_samp("return_pct").over(w))
        .withColumn("sample_size", F.count("return_pct").over(w))
        .filter(F.col("sample_size") >= 3)
        .withColumn("updated_at", F.current_timestamp())
        .select("date", "ticker", "volatility", "sample_size", "updated_at")
    )


def compute_news_volume_per_coin(silver):
    """Headline count per (date, ticker)."""
    return (
        silver.filter(F.col("source_type") == F.lit("crypto_news"))
        .filter(F.col("ticker").isNotNull())
        .groupBy("date", "ticker")
        .agg(F.count("*").alias("headline_count"))
        .withColumn("updated_at", F.current_timestamp())
        .select("date", "ticker", "headline_count", "updated_at")
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Gold KPI aggregation job.")
    parser.add_argument("--date", default=None, help="Optional date filter (YYYY-MM-DD).")
    args = parser.parse_args()

    spark = build_spark()
    spark.sparkContext.setLogLevel("WARN")
    started = time.time()

    try:
        silver = read_silver(spark)
        if args.date:
            silver = silver.filter(F.col("partition_date") == args.date)
        record_count = silver.count()
        if record_count == 0:
            logger.warning("Silver is empty, nothing to aggregate.")
            return 0
        logger.info("Silver records: %d", record_count)

        daily_prices = compute_daily_prices(silver)
        daily_returns = compute_daily_returns(daily_prices)
        top_movers = compute_top_movers(daily_returns)
        rolling_volatility = compute_rolling_volatility_7d(daily_returns)
        news_volume = compute_news_volume_per_coin(silver)

        logger.info("Writing daily_prices...")
        write_postgres(daily_prices, "gold.daily_prices", mode="append")
        logger.info("Writing daily_returns...")
        write_postgres(daily_returns, "gold.daily_returns", mode="append")
        logger.info("Writing top_movers...")
        write_postgres(top_movers, "gold.top_movers", mode="append")
        logger.info("Writing rolling_volatility_7d...")
        write_postgres(rolling_volatility, "gold.rolling_volatility_7d", mode="append")
        logger.info("Writing news_volume_per_coin...")
        write_postgres(news_volume, "gold.news_volume_per_coin", mode="append")

        duration = time.time() - started
        logger.info("Gold job complete in %.2fs", duration)
        return 0
    finally:
        spark.stop()


if __name__ == "__main__":
    raise SystemExit(main())

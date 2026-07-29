"""Gold layer: Silver Parquet → Postgres KPIs.

Reads /data/silver/data (Parquet, partitioned by source_type + date),
computes daily sentiment via VADER, mention volume, and 7-day rolling
trend. Writes to Postgres schema `gold`.

KPIs:
- gold.sentiment_daily  : avg VADER sentiment per source_type per date
- gold.mention_volume   : post/comment/article counts per source_type per date
- gold.top_entities     : top subreddits and news sources per 7-day window
- gold.sentiment_trend_7d : 7-day moving average of sentiment

Run via spark-submit inside spark-master container:
    docker compose exec spark-master spark-submit \\
        --master spark://spark-master:7077 \\
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
from typing import Iterator

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


def vader_udf_factory():
    """Create a Spark UDF that returns VADER compound score in [-1, 1]."""
    analyzer = SentimentIntensityAnalyzer()

    @F.udf(returnType=T.FloatType())
    def vader_score(text: str) -> float:
        if not text:
            return 0.0
        return analyzer.polarity_scores(text)["compound"]

    return vader_score


def read_silver(spark: SparkSession):
    return spark.read.parquet(SILVER_BASE)


def write_postgres(df, table: str, mode: str = "append") -> None:
    """Write a Spark DataFrame to Postgres via JDBC."""
    (
        df.write.format("jdbc")
        .option("url", PG_URL)
        .option("dbtable", table)
        .option("user", PG_USER)
        .option("password", PG_PASS)
        .option("driver", "org.postgresql.Driver")
        .mode(mode)
        .save()
    )


def compute_sentiment_daily(silver):
    """Average VADER sentiment per (date, source, source_type)."""
    vader = vader_udf_factory()
    with_scores = (
        silver.withColumn("text", F.concat_ws(" ", F.col("title"), F.col("body")))
        .withColumn("sentiment", vader(F.col("text")))
    )
    return (
        with_scores.groupBy("partition_date", "source", "source_type")
        .agg(
            F.avg("sentiment").alias("avg_sentiment"),
            F.count("*").alias("record_count"),
        )
        .withColumnRenamed("partition_date", "date")
        .select("date", "source", "source_type", "avg_sentiment", "record_count")
    )


def compute_mention_volume(silver):
    return (
        silver.groupBy("partition_date", "source", "source_type")
        .agg(F.count("*").alias("mention_count"))
        .withColumnRenamed("partition_date", "date")
        .select("date", "source", "source_type", "mention_count")
    )


def compute_top_entities(silver):
    """Top 20 subreddits and source_names by mention count over all data."""
    subreddit_counts = (
        silver.filter(F.col("subreddit").isNotNull())
        .groupBy("subreddit")
        .agg(F.count("*").alias("mention_count"))
        .withColumn("entity_type", F.lit("subreddit"))
        .withColumnRenamed("subreddit", "entity_name")
    )
    source_name_counts = (
        silver.filter(F.col("source_name").isNotNull())
        .groupBy("source_name")
        .agg(F.count("*").alias("mention_count"))
        .withColumn("entity_type", F.lit("source_name"))
        .withColumnRenamed("source_name", "entity_name")
    )
    today = dt.date.today()
    combined = subreddit_counts.unionByName(source_name_counts)
    return (
        combined.orderBy(F.col("mention_count").desc())
        .limit(40)
        .withColumn("window_end", F.lit(today).cast("date"))
        .withColumn("avg_sentiment", F.lit(0.0))
        .select("window_end", "entity_type", "entity_name", "mention_count", "avg_sentiment")
    )


def compute_sentiment_trend_7d(sentiment_daily):
    """7-day moving average of sentiment per source."""
    window = (
        Window.partitionBy("source")
        .orderBy("date")
        .rowsBetween(-6, 0)
    )
    return (
        sentiment_daily.withColumn(
            "avg_sentiment_7d", F.avg("avg_sentiment").over(window)
        )
        .select("date", "source", "avg_sentiment_7d")
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Gold KPI aggregation job.")
    parser.add_argument(
        "--date",
        default=None,
        help="Optional date filter (YYYY-MM-DD). If set, restricts to that date.",
    )
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

        sentiment_daily = compute_sentiment_daily(silver)
        mention_volume = compute_mention_volume(silver)
        top_entities = compute_top_entities(silver)
        sentiment_trend_7d = compute_sentiment_trend_7d(sentiment_daily)

        logger.info("Writing sentiment_daily...")
        write_postgres(sentiment_daily, "gold.sentiment_daily", mode="append")
        logger.info("Writing mention_volume...")
        write_postgres(mention_volume, "gold.mention_volume", mode="append")
        logger.info("Writing top_entities...")
        write_postgres(top_entities, "gold.top_entities", mode="append")
        logger.info("Writing sentiment_trend_7d...")
        write_postgres(sentiment_trend_7d, "gold.sentiment_trend_7d", mode="append")

        duration = time.time() - started
        logger.info("Gold job complete in %.2fs", duration)
        return 0
    finally:
        spark.stop()


if __name__ == "__main__":
    raise SystemExit(main())

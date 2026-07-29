"""Silver layer: Bronze JSON → cleaned, deduplicated Parquet.

Reads /data/bronze/{source}/{date}/posts.jsonl from HDFS,
validates schema, removes duplicates via SHA-256 hash on
(source, external_id, ingested_at), and writes Parquet partitioned
by source_type + date.

Run via spark-submit inside the spark-master container:
    docker compose exec spark-master spark-submit \\
        --master spark://spark-master:7077 \\
        /opt/spark/jobs/silver_transform.py
"""

from __future__ import annotations

import argparse
import json
import logging
import time

from pyspark.sql import SparkSession, functions as F
from pyspark.sql.window import Window

from jobs.silver_utils import build_schema, row_hash  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

BRONZE_BASE = "hdfs://namenode:9000/data/bronze"
SILVER_BASE = "hdfs://namenode:9000/data/silver"

# Backward-compat re-exports (so existing callers that imported row_hash
# from silver_transform keep working).
__all__ = ["build_spark", "load_bronze", "count_nulls", "transform", "main", "row_hash"]


def build_spark() -> SparkSession:
    return (
        SparkSession.builder.appName("silver_transform")
        .master("spark://spark-master:7077")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.shuffle.partitions", "4")
        .getOrCreate()
    )


def load_bronze(spark: SparkSession, date_str: str):
    """Load Bronze JSON files for a given date across all sources."""
    frames = []
    for source in ("reddit", "news"):
        path = f"{BRONZE_BASE}/{source}/{date_str}/"
        try:
            df = spark.read.schema(build_schema()).json(path)
            frames.append(df)
            logger.info("Loaded %s from %s", source, path)
        except Exception as exc:  # noqa: BLE001
            logger.warning("No Bronze data for %s/%s: %s", source, date_str, exc)
    if not frames:
        return None
    return frames[0] if len(frames) == 1 else frames[0].unionByName(frames[1])


def count_nulls(df, columns):
    """Return dict of column -> null count."""
    exprs = [F.sum(F.col(c).isNull().cast("int")).alias(c) for c in columns]
    row = df.agg(*exprs).collect()[0]
    return {c: int(row[c] or 0) for c in columns}


def transform(spark: SparkSession, date_str: str) -> dict:
    """Run the Silver transformation for one date. Returns metrics dict."""
    started = time.time()
    raw = load_bronze(spark, date_str)
    if raw is None:
        logger.warning("No Bronze data for %s, nothing to do.", date_str)
        return {"records_in": 0, "records_out": 0, "duplicates": 0, "invalid": 0}

    records_in = raw.count()
    logger.info("Records read from Bronze: %d", records_in)

    tracked_cols = ["source", "source_type", "external_id", "title", "body", "ingested_at"]
    nulls_before = count_nulls(raw, tracked_cols)
    logger.info("Nulls per column: %s", nulls_before)

    cleaned = raw.withColumn(
        "dedup_hash",
        F.sha2(
            F.concat_ws(
                "|",
                F.coalesce(F.col("source"), F.lit("")),
                F.coalesce(F.col("external_id").cast("string"), F.lit("")),
                F.coalesce(F.col("ingested_at"), F.lit("")),
            ),
            256,
        ),
    ).withColumn("partition_date", F.lit(date_str))

    dedup_window = Window.partitionBy("dedup_hash").orderBy(F.col("ingested_at").desc())
    deduped = (
        cleaned.withColumn("_rank", F.row_number().over(dedup_window))
        .filter(F.col("_rank") == 1)
        .drop("_rank")
    )

    records_after_dedup = deduped.count()
    duplicates = records_in - records_after_dedup
    logger.info("Duplicates removed: %d", duplicates)

    invalid_mask = (
        F.col("source").isNull()
        | F.col("source_type").isNull()
        | F.col("external_id").isNull()
    )
    valid = deduped.filter(~invalid_mask)
    invalid = records_after_dedup - valid.count()
    logger.info("Invalid records removed: %d", invalid)

    silver_path = f"{SILVER_BASE}/data"
    (
        valid.write.mode("overwrite")
        .partitionBy("source_type", "partition_date")
        .parquet(silver_path)
    )
    logger.info("Wrote Silver Parquet to %s", silver_path)

    duration = time.time() - started
    logger.info("Silver job complete in %.2fs", duration)
    return {
        "records_in": records_in,
        "records_out": records_after_dedup - invalid,
        "duplicates": duplicates,
        "invalid": invalid,
        "duration_seconds": duration,
        "nulls": nulls_before,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Silver transformation job.")
    parser.add_argument("--date", required=True, help="Partition date (YYYY-MM-DD).")
    args = parser.parse_args()

    spark = build_spark()
    try:
        metrics = transform(spark, args.date)
        logger.info("Metrics: %s", json.dumps(metrics, default=str))
    finally:
        spark.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Silver layer: Bronze JSON → cleaned, deduplicated Parquet.

Reads /data/bronze/{stocks,crypto_live,crypto_news}/{date}/*.jsonl from HDFS,
validates schema, removes duplicates in two stages:
  1. Exact dedup: SHA-256 hash on (source, external_id, ingested_at).
  2. Approximate dedup: MinHash + LSH (datasketch) with Jaccard threshold 0.8
     on the headline field (5-word shingles) for crypto_news, or on body text.
Writes Parquet partitioned by source_type + date.

Run via spark-submit inside the spark-master container:
    docker compose exec spark-master spark-submit \\
        --master spark://spark-master:7077 \\
        /opt/spark/jobs/silver_transform.py
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
from functools import reduce
from pathlib import Path
from typing import Iterable

from pyspark.sql import SparkSession, functions as F
from pyspark.sql.window import Window

# spark-submit puts this file's own directory on sys.path, not the project
# root, so `jobs.silver_utils` is not importable without help.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jobs.silver_utils import build_schema  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

BRONZE_BASE = "hdfs://namenode:9000/data/bronze"
SILVER_BASE = "hdfs://namenode:9000/data/silver"

# Approximate dedup tuning
SHINGLE_SIZE = 5
MINHASH_PERM = 128
LSH_THRESHOLD = 0.8


def build_spark() -> SparkSession:
    return (
        SparkSession.builder.appName("silver_transform")
        .master("spark://spark-master:7077")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.shuffle.partitions", "4")
        # Dynamic overwrite replaces only the partitions present in this run.
        # Static (the default) would delete every prior date under /data/silver.
        .config("spark.sql.sources.partitionOverwriteMode", "dynamic")
        .getOrCreate()
    )


def load_bronze(spark: SparkSession, date_str: str):
    """Load all Bronze JSON files for a given date across the trading sources."""
    frames = []
    for source in ("stocks", "crypto_bulk", "crypto_live", "crypto_news"):
        path = f"{BRONZE_BASE}/{source}/{date_str}/"
        try:
            df = spark.read.schema(build_schema()).json(path)
            frames.append(df)
            logger.info("Loaded %s from %s", source, path)
        except Exception as exc:  # noqa: BLE001
            logger.warning("No Bronze data for %s/%s: %s", source, date_str, exc)
    if not frames:
        return None
    return reduce(lambda a, b: a.unionByName(b), frames)


def count_nulls(df, columns):
    """Return dict of column -> null count."""
    exprs = [F.sum(F.col(c).isNull().cast("int")).alias(c) for c in columns]
    row = df.agg(*exprs).collect()[0]
    return {c: int(row[c] or 0) for c in columns}


def _shingles(text: str, n: int = SHINGLE_SIZE) -> Iterable[str]:
    """Tokenize text into lowercase word n-grams."""
    if not text:
        return
    tokens = re.findall(r"\w+", text.lower())
    if len(tokens) < n:
        for t in tokens:
            yield t
        return
    for i in range(len(tokens) - n + 1):
        yield " ".join(tokens[i : i + n])


def find_near_duplicates(rows, threshold: float = LSH_THRESHOLD) -> set[str]:
    """Driver-side MinHash + LSH near-duplicate detection on the headline field."""
    from datasketch import MinHash, MinHashLSH  # noqa: WPS433

    if not rows:
        return set()

    sigs = {}
    for r in rows:
        ext_id = r.get("external_id")
        if not ext_id:
            continue
        text = r.get("headline") or r.get("url") or ""
        m = MinHash(num_perm=MINHASH_PERM)
        for sh in _shingles(text):
            m.update(sh.encode("utf-8"))
        sigs[ext_id] = m

    if len(sigs) < 2:
        return set()

    lsh = MinHashLSH(threshold=threshold, num_perm=MINHASH_PERM)
    for ext_id, m in sigs.items():
        lsh.insert(ext_id, m)

    seen_pairs: set[tuple[str, str]] = set()
    to_drop: set[str] = set()

    ids = list(sigs.keys())
    for ext_id in ids:
        candidates = lsh.query(sigs[ext_id])
        for cand in candidates:
            if cand == ext_id:
                continue
            pair = tuple(sorted((ext_id, cand)))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            loser = max(pair)
            to_drop.add(loser)

    return to_drop


def transform(spark: SparkSession, date_str: str) -> dict:
    """Run the Silver transformation for one date. Returns metrics dict."""
    started = time.time()
    raw = load_bronze(spark, date_str)
    if raw is None:
        logger.warning("No Bronze data for %s, nothing to do.", date_str)
        return {"records_in": 0, "records_out": 0, "duplicates_exact": 0, "duplicates_approx": 0, "invalid": 0}

    records_in = raw.count()
    logger.info("Records read from Bronze: %d", records_in)

    tracked_cols = ["source", "source_type", "ticker", "date", "close", "volume", "headline"]
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

    # Stage 1: exact dedup
    dedup_window = Window.partitionBy("dedup_hash").orderBy(F.col("ingested_at").desc())
    deduped = (
        cleaned.withColumn("_rank", F.row_number().over(dedup_window))
        .filter(F.col("_rank") == 1)
        .drop("_rank")
    )

    records_after_exact = deduped.count()
    duplicates_exact = records_in - records_after_exact
    logger.info("Exact duplicates removed: %d", duplicates_exact)

    # Stage 2: approximate dedup (MinHash + LSH on headline)
    headline_rows = (
        deduped.select(F.col("external_id"), F.col("headline"), F.col("url"))
        .filter(F.col("source_type") == F.lit("crypto_news"))
        .toLocalIterator()
    )

    def _consume(it):
        out = []
        for r in it:
            out.append({"external_id": r["external_id"], "headline": r["headline"], "url": r["url"]})
        return out

    news_rows = _consume(headline_rows)
    near_dup_ids = find_near_duplicates(news_rows)
    logger.info("Approximate duplicates found: %d", len(near_dup_ids))

    # Anti-join, not `isin`. Inlining tens of thousands of ids as SQL literals
    # builds a query plan large enough to blow up the JVM during analysis.
    if near_dup_ids:
        dup_df = spark.createDataFrame(
            [(i,) for i in near_dup_ids], "external_id string"
        ).hint("broadcast")
        after_approx = deduped.join(dup_df, on="external_id", how="left_anti")
    else:
        after_approx = deduped
    duplicates_approx = len(near_dup_ids)
    records_after_approx = after_approx.count()

    invalid_mask = (
        F.col("source").isNull()
        | F.col("source_type").isNull()
        | F.col("external_id").isNull()
        | F.col("date").isNull()
    )
    valid = after_approx.filter(~invalid_mask)
    invalid = records_after_approx - valid.count()
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
        "records_out": records_after_approx - invalid,
        "duplicates_exact": duplicates_exact,
        "duplicates_approx": duplicates_approx,
        "invalid": invalid,
        "duration_seconds": duration,
        "nulls": nulls_before,
    }


def push_silver_metrics(metrics: dict) -> None:
    """Emit the per-layer metrics Prometheus scrapes from the Pushgateway.

    Best-effort: a monitoring outage must not fail the pipeline.
    """
    try:
        from scripts.push_metrics import PushgatewayClient
    except ImportError:
        logger.warning("push_metrics unavailable, skipping Prometheus push")
        return

    client = PushgatewayClient(job="silver")
    client.observe("silver_records_in_total", value=metrics["records_in"])
    client.observe("silver_records_out_total", value=metrics["records_out"])
    client.observe("silver_duplicates_exact_total", value=metrics["duplicates_exact"])
    client.observe("silver_duplicates_approximate_total", value=metrics["duplicates_approx"])
    client.observe("silver_invalid_records_total", value=metrics["invalid"])
    client.observe("silver_transform_duration_seconds", value=metrics.get("duration_seconds", 0))
    for column, count in (metrics.get("nulls") or {}).items():
        client.observe("silver_null_count_total", labels={"column": column}, value=count)
    client.push()


def main() -> int:
    parser = argparse.ArgumentParser(description="Silver transformation job.")
    parser.add_argument("--date", required=True, help="Partition date (YYYY-MM-DD).")
    args = parser.parse_args()

    spark = build_spark()
    try:
        metrics = transform(spark, args.date)
        logger.info("Metrics: %s", json.dumps(metrics, default=str))
        push_silver_metrics(metrics)
    finally:
        spark.stop()

    # Reading zero Bronze records means a broken path, an unreachable namenode,
    # or a missing ingest — never a healthy run. Exiting 0 here made the
    # dashboard and `make demo` report success on an empty pipeline.
    if metrics["records_in"] == 0:
        logger.error(
            "No Bronze records read for %s. Check that ingestion ran and that "
            "HDFS is reachable at %s.",
            args.date,
            BRONZE_BASE,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

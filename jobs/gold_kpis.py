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
import logging
import os
import time

from pyspark.sql import SparkSession, functions as F, Window

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SILVER_BASE = "hdfs://namenode:9000/data/silver/data"

PG_HOST = os.environ.get("POSTGRES_HOST", "postgres")
PG_PORT = os.environ.get("POSTGRES_PORT", "5432")
PG_DB = os.environ.get("POSTGRES_DB", "gold")
PG_USER = os.environ.get("POSTGRES_USER", "gold")
PG_PASS = os.environ.get("POSTGRES_PASSWORD", "gold")
PG_URL = f"jdbc:postgresql://{PG_HOST}:{PG_PORT}/{PG_DB}"

# Every source_type that carries headline text. `crypto_news` comes from the
# bundled CryptoDataDownload archive; `news` from the live RSS feeds.
NEWS_SOURCE_TYPES = ["crypto_news", "news"]


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


def truncate_table(spark: SparkSession, table: str) -> None:
    """Empty a Gold table, keeping its DDL.

    Spark's own `.mode("overwrite")` cannot be used here. With
    `truncate=false` it DROPs the table and recreates it from the DataFrame
    schema, losing the primary keys, RANGE partitioning, and indexes declared
    in sql/gold_schema.sql. With `truncate=true` it still drops, because
    Spark's PostgresDialect reports TRUNCATE as cascading and refuses it.

    So issue the TRUNCATE ourselves over the JDBC driver the JVM already has
    (pulled in by --packages), then append.
    """
    jvm = spark._jvm  # noqa: SLF001 - py4j gateway is the documented access path
    props = jvm.java.util.Properties()
    props.setProperty("user", PG_USER)
    props.setProperty("password", PG_PASS)
    conn = jvm.java.sql.DriverManager.getConnection(PG_URL, props)
    try:
        stmt = conn.createStatement()
        stmt.execute(f"TRUNCATE TABLE {table}")
        stmt.close()
    finally:
        conn.close()


def write_postgres(spark: SparkSession, df, table: str) -> None:
    """Replace a Gold table's contents. Idempotent: safe to re-run `make load`."""
    truncate_table(spark, table)
    # Cast date column to DATE so Postgres accepts it (Silver stores dates as strings)
    casted = df.withColumn("date", F.col("date").cast("date"))
    (
        casted.write.format("jdbc")
        .option("url", PG_URL)
        .option("dbtable", table)
        .option("user", PG_USER)
        .option("password", PG_PASS)
        .option("driver", "org.postgresql.Driver")
        .mode("append")
        .save()
    )


def compute_daily_prices(silver):
    """OHLCV per (date, ticker, source). Matches the daily_prices primary key.

    Aggregates are deterministic (max/min/sum, not first) because Bronze can
    carry more than one row per key and `first` would depend on shuffle order.
    """
    return (
        silver.filter(~F.col("source_type").isin(NEWS_SOURCE_TYPES + ["intraday"]))
        .filter(F.col("close").isNotNull())
        .groupBy("date", "ticker", "source")
        .agg(F.max("open").alias("open"),
             F.max("high").alias("high"),
             F.min("low").alias("low"),
             F.max("close").alias("close"),
             F.sum("volume").alias("volume"))
        .withColumn("updated_at", F.current_timestamp())
        .select("date", "ticker", "source", "open", "high", "low", "close", "volume", "updated_at")
    )


def collapse_to_one_source(daily_prices):
    """One row per (date, ticker), from a single source per ticker.

    daily_prices is keyed on (date, ticker, source), but daily_returns and
    everything downstream is keyed on (date, ticker) only. Two sources for one
    ticker would otherwise produce two rows per day — a primary-key violation.

    The source is chosen per *ticker*, not per (ticker, date). Choosing per
    date lets the series hop between feeds mid-history: BTC switched from the
    archive to the live API and manufactured a +180% single-day return, which
    then poisoned volatility and top movers. Pick the feed with the longest
    history for that ticker and stay on it.
    """
    ranked_sources = (
        daily_prices.groupBy("ticker", "source")
        .agg(F.count("*").alias("_rows"))
        .withColumn(
            "_rank",
            F.row_number().over(
                Window.partitionBy("ticker").orderBy(F.col("_rows").desc(), F.col("source").asc())
            ),
        )
        .filter(F.col("_rank") == 1)
        .select("ticker", "source")
    )
    return daily_prices.join(F.broadcast(ranked_sources), on=["ticker", "source"], how="inner")


def compute_daily_returns(daily_prices):
    """Per-ticker pct change vs previous trading day."""
    w = Window.partitionBy("ticker").orderBy("date")
    prev = F.lag("close").over(w)
    return (
        collapse_to_one_source(daily_prices)
        .withColumn("prev_close", prev)
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
        silver.filter(F.col("source_type").isin(NEWS_SOURCE_TYPES))
        .filter(F.col("ticker").isNotNull())
        .groupBy("date", "ticker")
        .agg(F.count("*").alias("headline_count"))
        .withColumn("updated_at", F.current_timestamp())
        .select("date", "ticker", "headline_count", "updated_at")
    )


def sentiment_udf():
    """VADER compound score in [-1, 1], as a Spark UDF.

    VADER is lexicon-based: no model download, no GPU, runs fine on the
    executors. The analyzer is cached per executor because constructing it
    parses a ~7500-entry lexicon, which is far too expensive per row.
    """
    from pyspark.sql.types import DoubleType

    cache: dict[str, object] = {}

    def score(headline):
        if not headline:
            return None
        analyzer = cache.get("analyzer")
        if analyzer is None:
            from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

            analyzer = SentimentIntensityAnalyzer()
            cache["analyzer"] = analyzer
        return float(analyzer.polarity_scores(headline)["compound"])  # type: ignore[union-attr]

    return F.udf(score, DoubleType())


def compute_news_headlines(silver, limit_per_ticker: int = 2000):
    """Recent headline text per ticker, scored with VADER sentiment.

    Backs the per-symbol news feed, the word cloud, and the news markers drawn
    on the price chart.
    """
    w = Window.partitionBy("ticker").orderBy(F.col("date").desc())
    score = sentiment_udf()
    return (
        silver.filter(F.col("source_type").isin(NEWS_SOURCE_TYPES))
        .filter(F.col("headline").isNotNull())
        .filter(F.col("ticker").isNotNull())
        .withColumn("_rank", F.row_number().over(w))
        .filter(F.col("_rank") <= limit_per_ticker)
        .withColumn("sentiment", score(F.col("headline")))
        .withColumn(
            "sentiment_label",
            F.when(F.col("sentiment") > 0.15, F.lit("positive"))
            .when(F.col("sentiment") < -0.15, F.lit("negative"))
            .otherwise(F.lit("neutral")),
        )
        .withColumn("updated_at", F.current_timestamp())
        .select("date", "ticker", "headline", "url", "source", "sentiment", "sentiment_label", "updated_at")
    )


def compute_news_sentiment_daily(news_headlines, daily_returns):
    """Daily average sentiment per ticker, joined to that day's return.

    This is the table that answers the actual business question: does the tone
    of the news line up with how the price moved? Keeping both columns on one
    row lets the dashboard chart them together and lets SQL correlate them.
    """
    daily = (
        news_headlines.groupBy("date", "ticker")
        .agg(
            F.avg("sentiment").alias("avg_sentiment"),
            F.count("*").alias("headline_count"),
            F.sum(F.when(F.col("sentiment") > 0.15, 1).otherwise(0)).alias("positive_count"),
            F.sum(F.when(F.col("sentiment") < -0.15, 1).otherwise(0)).alias("negative_count"),
        )
    )
    return (
        daily.join(daily_returns.select("date", "ticker", "return_pct"), ["date", "ticker"], "left")
        .withColumn("updated_at", F.current_timestamp())
        .select(
            "date", "ticker", "avg_sentiment", "headline_count",
            "positive_count", "negative_count", "return_pct", "updated_at",
        )
    )


def compute_intraday_prices(silver):
    """Sub-daily OHLCV bars, keyed on (ticker, ts, interval).

    Feeds the chart's 1m/5m/15m/1h timeframes. The daily archive cannot serve
    those, so these rows come from the Yahoo chart API via
    scripts/fetch_intraday.py.
    """
    return (
        silver.filter(F.col("source_type") == F.lit("intraday"))
        .filter(F.col("ts").isNotNull())
        .filter(F.col("close").isNotNull())
        # One Bronze file can be re-ingested; collapse to the last write per bar.
        .groupBy("ticker", "ts", "interval")
        .agg(
            F.max("date").alias("date"),
            F.max("open").alias("open"),
            F.max("high").alias("high"),
            F.min("low").alias("low"),
            F.max("close").alias("close"),
            F.max("volume").alias("volume"),
        )
        .withColumn("ts", F.to_timestamp("ts"))
        .withColumn("updated_at", F.current_timestamp())
        .select("ticker", "ts", "interval", "date", "open", "high", "low", "close", "volume", "updated_at")
    )


def compute_silver_sample(silver, per_source: int = 300):
    """A materialised slice of Silver, so the dashboard can display it.

    Silver lives in Parquet on HDFS, which the dashboard cannot read: it speaks
    SQL and HTTP, not Parquet, and WebHDFS reads redirect to an unreachable
    datanode host. Publishing a bounded sample per source_type keeps the
    Medallion layers inspectable end to end without a second query engine.
    """
    w = Window.partitionBy("source_type").orderBy(F.col("date").desc(), F.col("ticker").asc())
    return (
        silver.withColumn("_rank", F.row_number().over(w))
        .filter(F.col("_rank") <= per_source)
        .withColumn("updated_at", F.current_timestamp())
        .select(
            "source_type", "source", "external_id", "ticker", "date",
            "open", "high", "low", "close", "volume", "headline",
            "ingested_at", "updated_at",
        )
    )


def push_gold_metrics(tables: dict, duration: float) -> None:
    """Emit per-table row counts to the Pushgateway. Best-effort."""
    try:
        from scripts.push_metrics import PushgatewayClient
    except ImportError:
        logger.warning("push_metrics unavailable, skipping Prometheus push")
        return

    client = PushgatewayClient(job="gold")
    client.observe("gold_kpi_compute_duration_seconds", value=duration)
    for table, df in tables.items():
        # The DataFrames are already materialised in Postgres; counting here is
        # a cheap re-read compared to the write that just happened.
        client.observe("gold_rows_loaded_total", labels={"table": table}, value=df.count())
    client.push()


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
        news_headlines = compute_news_headlines(silver).cache()
        news_sentiment = compute_news_sentiment_daily(news_headlines, daily_returns)
        intraday = compute_intraday_prices(silver)

        logger.info("Writing daily_prices...")
        write_postgres(spark, daily_prices, "gold.daily_prices")
        logger.info("Writing daily_returns...")
        write_postgres(spark, daily_returns, "gold.daily_returns")
        logger.info("Writing top_movers...")
        write_postgres(spark, top_movers, "gold.top_movers")
        logger.info("Writing rolling_volatility_7d...")
        write_postgres(spark, rolling_volatility, "gold.rolling_volatility_7d")
        logger.info("Writing news_volume_per_coin...")
        write_postgres(spark, news_volume, "gold.news_volume_per_coin")
        logger.info("Writing news_headlines...")
        write_postgres(spark, news_headlines, "gold.news_headlines")
        logger.info("Writing news_sentiment_daily...")
        write_postgres(spark, news_sentiment, "gold.news_sentiment_daily")
        logger.info("Writing intraday_prices...")
        write_postgres(spark, intraday, "gold.intraday_prices")
        logger.info("Writing silver_sample...")
        write_postgres(spark, compute_silver_sample(silver), "gold.silver_sample")

        duration = time.time() - started
        logger.info("Gold job complete in %.2fs", duration)
        push_gold_metrics(
            {
                "gold.daily_prices": daily_prices,
                "gold.daily_returns": daily_returns,
                "gold.top_movers": top_movers,
                "gold.rolling_volatility_7d": rolling_volatility,
                "gold.news_volume_per_coin": news_volume,
                "gold.news_headlines": news_headlines,
                "gold.news_sentiment_daily": news_sentiment,
                "gold.intraday_prices": intraday,
            },
            duration,
        )
        return 0
    finally:
        spark.stop()


if __name__ == "__main__":
    raise SystemExit(main())

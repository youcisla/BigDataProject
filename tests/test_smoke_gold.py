"""Smoke test for Gold layer: KPI shapes and Postgres connection wiring."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

pytest.importorskip("pyspark")

from jobs import gold_kpis  # noqa: E402


def test_postgres_url_from_env(monkeypatch):
    monkeypatch.setenv("POSTGRES_HOST", "test-host")
    monkeypatch.setenv("POSTGRES_PORT", "5433")
    monkeypatch.setenv("POSTGRES_DB", "test-db")

    importlib.reload(gold_kpis)
    try:
        assert gold_kpis.PG_URL == "jdbc:postgresql://test-host:5433/test-db"
    finally:
        monkeypatch.undo()
        importlib.reload(gold_kpis)


@pytest.fixture(scope="module")
def spark():
    from pyspark.sql import SparkSession

    session = (
        SparkSession.builder.appName("gold_smoke")
        .master("local[1]")
        .config("spark.sql.shuffle.partitions", "1")
        .config("spark.ui.enabled", "false")
        .getOrCreate()
    )
    yield session
    session.stop()


@pytest.fixture()
def silver_10(spark):
    """10 Silver records: 2 tickers x 4 price days, plus 2 headlines."""
    rows = []
    for i, day in enumerate(["2021-05-01", "2021-05-02", "2021-05-03", "2021-05-04"], start=1):
        rows.append(("stock_ohlcv", "AAPL", "cdd_stock", day, 100.0 + i, None))
        rows.append(("crypto_ohlcv", "BTC", "cdd_btc", day, 50000.0 - (i * 500), None))
    rows.append(("crypto_news", "BTC", "cdd_btc", "2021-05-01", None, "bitcoin rallies"))
    rows.append(("crypto_news", "BTC", "cdd_btc", "2021-05-01", None, "btc hits new high"))

    from pyspark.sql import functions as F

    return (
        spark.createDataFrame(
            rows,
            "source_type string, ticker string, source string, date string, "
            "close double, headline string",
        )
        .withColumn("open", F.col("close"))
        .withColumn("high", F.col("close"))
        .withColumn("low", F.col("close"))
        .withColumn("volume", F.lit(None).cast("long"))
    )


def test_daily_prices_excludes_news_rows(silver_10):
    prices = gold_kpis.compute_daily_prices(silver_10)
    assert prices.count() == 8  # 2 tickers x 4 days; the 2 headlines are dropped


def test_daily_returns_has_one_row_per_ticker_day(silver_10):
    """Guards the daily_returns (date, ticker) primary key."""
    prices = gold_kpis.compute_daily_prices(silver_10)
    returns = gold_kpis.compute_daily_returns(prices)

    # First day per ticker has no previous close, so 2 tickers x 3 days.
    assert returns.count() == 6
    assert returns.select("date", "ticker").distinct().count() == returns.count()


def test_daily_returns_sign_follows_price_direction(silver_10):
    prices = gold_kpis.compute_daily_prices(silver_10)
    returns = {
        (r["ticker"], r["date"]): r["return_pct"]
        for r in gold_kpis.compute_daily_returns(prices).collect()
    }
    assert returns[("AAPL", "2021-05-02")] > 0  # AAPL rises each day
    assert returns[("BTC", "2021-05-02")] < 0  # BTC falls each day


def test_collapse_to_one_source_drops_duplicate_ticker_days(spark):
    """A ticker carried by two sources must not yield two rows per day."""
    from pyspark.sql import functions as F

    dual = spark.createDataFrame(
        [("2021-05-01", "BTC", "source_a", 100.0), ("2021-05-01", "BTC", "source_b", 101.0)],
        "date string, ticker string, source string, close double",
    ).withColumn("updated_at", F.current_timestamp())

    collapsed = gold_kpis.collapse_to_one_source(dual)

    assert collapsed.count() == 1
    assert collapsed.collect()[0]["source"] == "source_a"  # deterministic: lowest source


def test_news_volume_counts_only_headlines(silver_10):
    volume = gold_kpis.compute_news_volume_per_coin(silver_10).collect()
    assert len(volume) == 1
    assert volume[0]["ticker"] == "BTC"
    assert volume[0]["headline_count"] == 2


def test_top_movers_labels_both_directions(silver_10):
    prices = gold_kpis.compute_daily_prices(silver_10)
    movers = gold_kpis.compute_top_movers(gold_kpis.compute_daily_returns(prices))
    directions = {r["direction"] for r in movers.collect()}
    assert directions == {"gain", "loss"}

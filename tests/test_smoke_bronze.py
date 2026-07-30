"""Smoke test for Bronze layer: 10 records in, 10 JSON Lines out."""

from __future__ import annotations

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from scripts import fetch_crypto, fetch_stocks  # noqa: E402
from scripts.upload_to_hdfs import bronze_path, upload_json_lines  # noqa: E402


def test_stock_row_normalizes_to_silver_schema():
    row = {
        "Date": "2016-01-04",
        "Open": "25.65",
        "High": "26.34",
        "Low": "25.50",
        "Close": "26.10",
        "Volume": "31161000",
        "OpenInt": "0",
    }
    out = fetch_stocks.normalize_row(row, "AAPL", "cryptodatadownload_stock")

    assert out["source_type"] == "stock_ohlcv"
    assert out["ticker"] == "AAPL"
    assert out["close"] == 26.10
    assert out["volume"] == 31161000
    # external_id must be stable — it is the exact-dedup key in Silver.
    assert out["external_id"] == "AAPL|2016-01-04|cryptodatadownload_stock"


def test_stock_row_tolerates_blank_numerics():
    out = fetch_stocks.normalize_row({"Date": "2016-01-04", "Close": ""}, "AAPL", "s")
    assert out["close"] is None
    assert out["volume"] is None


def test_ticker_parsed_from_filename():
    assert fetch_stocks.ticker_from_filename(Path("data/Stocks/aapl.us.txt")) == "AAPL"


def test_crypto_ohlcv_and_news_are_distinct_record_types():
    """Bronze must emit crypto OHLCV and headlines as separate source_types."""
    raw = {"begins_at": "2021-05-01", "close_price": "57000.5", "symbol": "BTC"}
    ohlcv = fetch_crypto.normalize_ohlcv_row(raw, "BTC", "cdd_btc")
    news = fetch_crypto.normalize_news_row("BTC", "Bitcoin hits new high", "2021-05-01", "cdd_btc")

    assert ohlcv["source_type"] == "crypto_ohlcv"
    assert news["source_type"] == "crypto_news"
    assert ohlcv["external_id"] != news["external_id"]


def test_articles_column_parses_to_headline_list():
    raw = "['Bitcoin hits new high', 'ETH merge completes']"
    assert fetch_crypto.safe_parse_articles(raw) == [
        "Bitcoin hits new high",
        "ETH merge completes",
    ]


def test_articles_column_handles_empty_and_malformed():
    assert fetch_crypto.safe_parse_articles("") == []
    assert fetch_crypto.safe_parse_articles("[]") == []
    assert fetch_crypto.safe_parse_articles(None) == []


def test_ten_records_write_ten_json_lines(tmp_path, monkeypatch):
    """The core Bronze guarantee: N records in, N parseable lines out."""
    # Force the local-filesystem fallback so the test needs no live HDFS.
    monkeypatch.setattr("scripts.upload_to_hdfs._hdfs_client", lambda: None)
    monkeypatch.setenv("BRONZE_LOCAL_FALLBACK", str(tmp_path))

    hdfs_target = bronze_path("stocks", "2026-07-30", "ohlcv.jsonl")
    records = [
        fetch_stocks.normalize_row({"Date": f"2016-01-{d:02d}", "Close": str(d)}, "AAPL", "test")
        for d in range(1, 11)
    ]

    count = upload_json_lines(iter(records), hdfs_target)

    assert count == 10
    written = tmp_path / "data" / "bronze" / "stocks" / "2026-07-30" / "ohlcv.jsonl"
    lines = written.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 10
    assert all(json.loads(line)["ticker"] == "AAPL" for line in lines)


def test_bronze_path_is_date_partitioned():
    assert (
        bronze_path("crypto_news", "2026-07-30", "headlines.jsonl")
        == "/data/bronze/crypto_news/2026-07-30/headlines.jsonl"
    )
    assert bronze_path("stocks", "2026-07-30") == "/data/bronze/stocks/2026-07-30/data.jsonl"

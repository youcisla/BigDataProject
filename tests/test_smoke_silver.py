"""Smoke test for Silver layer: dedup keys, schema, and near-duplicate detection."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from jobs import silver_utils  # noqa: E402


def test_row_hash_is_deterministic():
    a = silver_utils.row_hash("cdd_btc", "BTC|2021-05-01|cdd_btc", "2026-07-30T10:00:00")
    b = silver_utils.row_hash("cdd_btc", "BTC|2021-05-01|cdd_btc", "2026-07-30T10:00:00")
    assert a == b
    assert len(a) == 64  # SHA-256 hex length


def test_row_hash_changes_with_each_component():
    base = silver_utils.row_hash("s", "id", "t")
    assert base != silver_utils.row_hash("other", "id", "t")
    assert base != silver_utils.row_hash("s", "other", "t")
    assert base != silver_utils.row_hash("s", "id", "other")


def test_schema_carries_the_trading_fields():
    fields = set(silver_utils.field_names())
    # Dedup keys, the natural join key, OHLCV, and the unstructured column.
    assert {"source", "source_type", "external_id", "ingested_at"} <= fields
    assert {"ticker", "date", "open", "high", "low", "close", "volume"} <= fields
    assert "headline" in fields


def test_numeric_fields_are_not_typed_as_strings():
    types = silver_utils.expected_field_types()
    assert types["close"] == "double"
    assert types["volume"] == "long"
    assert types["headline"] == "string"


def test_build_schema_matches_field_list():
    pytest.importorskip("pyspark")
    from pyspark.sql.types import StructType

    schema = silver_utils.build_schema()
    assert isinstance(schema, StructType)
    assert [f.name for f in schema.fields] == silver_utils.field_names()


def test_near_duplicate_headlines_are_detected():
    """Approximate dedup must catch reworded-but-equivalent headlines."""
    pytest.importorskip("datasketch")
    pytest.importorskip("pyspark")
    from jobs.silver_transform import find_near_duplicates

    shared = "bitcoin surges past sixty thousand dollars amid institutional buying pressure today"
    rows = [
        {"external_id": "a", "headline": shared, "url": None},
        {"external_id": "b", "headline": shared, "url": None},
        {"external_id": "c", "headline": "ethereum merge completes after years of long delays", "url": None},
    ]

    dropped = find_near_duplicates(rows)

    # Exactly one of the identical pair is dropped; the distinct one survives.
    assert len(dropped) == 1
    assert dropped < {"a", "b"}
    assert "c" not in dropped


def test_distinct_headlines_are_not_deduplicated():
    pytest.importorskip("datasketch")
    pytest.importorskip("pyspark")
    from jobs.silver_transform import find_near_duplicates

    rows = [
        {"external_id": "a", "headline": "bitcoin rallies on spot etf approval news today", "url": None},
        {"external_id": "b", "headline": "solana network suffers an extended validator outage", "url": None},
    ]
    assert find_near_duplicates(rows) == set()

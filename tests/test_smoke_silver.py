"""Smoke test for Silver layer: verify dedup hash + schema validation logic."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from jobs import silver_transform  # noqa: E402


def test_row_hash_is_deterministic():
    """Same inputs always produce same SHA-256."""
    h1 = silver_transform.row_hash("reddit", "abc123", "2026-07-29T10:00:00")
    h2 = silver_transform.row_hash("reddit", "abc123", "2026-07-29T10:00:00")
    assert h1 == h2
    assert len(h1) == 64  # SHA-256 hex length


def test_row_hash_changes_with_inputs():
    """Different inputs produce different hashes."""
    a = silver_transform.row_hash("reddit", "abc123", "2026-07-29T10:00:00")
    b = silver_transform.row_hash("reddit", "abc456", "2026-07-29T10:00:00")
    c = silver_transform.row_hash("news", "abc123", "2026-07-29T10:00:00")
    d = silver_transform.row_hash("reddit", "abc123", "2026-07-29T11:00:00")
    assert a != b
    assert a != c
    assert a != d


def test_expected_fields_present():
    """Schema contains the key fields we need."""
    required = {"source", "source_type", "external_id", "ingested_at"}
    assert required.issubset(silver_transform.EXPECTED_FIELDS.keys())


def test_build_schema_is_struct_type():
    """Schema builder returns a Spark StructType."""
    from pyspark.sql.types import StructType

    schema = silver_transform._build_schema()
    assert isinstance(schema, StructType)
    assert len(schema.fields) == len(silver_transform.EXPECTED_FIELDS)

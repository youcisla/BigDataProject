"""Silver-layer utility functions that don't require pyspark at import time.

Lets unit tests import helpers without the heavy Spark dependency.
"""

from __future__ import annotations

import hashlib

# Field name -> pyspark type string. Defer pyspark import to first use.
_FIELD_TYPES = {
    "source": "string",
    "source_type": "string",
    "external_id": "string",
    "subreddit": "string",
    "author": "string",
    "title": "string",
    "body": "string",
    "score": "long",
    "num_comments": "long",
    "url": "string",
    "created_utc": "double",
    "ingested_at": "string",
    "source_name": "string",
    "published_at": "string",
    "category": "string",
}


def row_hash(source: str, external_id: str, ingested_at: str) -> str:
    """SHA-256 hex digest of the dedup key (source, external_id, ingested_at)."""
    payload = f"{source}|{external_id}|{ingested_at}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def field_names() -> list[str]:
    """Return the canonical field name list for the Silver layer."""
    return list(_FIELD_TYPES.keys())


def expected_field_types() -> dict[str, str]:
    """Return field name -> pyspark type string."""
    return dict(_FIELD_TYPES)


def build_schema():
    """Build the Spark StructType from the field name -> type mapping."""
    try:
        from pyspark.sql import types as T  # noqa: WPS433
    except ImportError as exc:
        raise RuntimeError("pyspark not installed; cannot build Spark schema") from exc

    type_map = {
        "string": T.StringType(),
        "long": T.LongType(),
        "double": T.DoubleType(),
    }
    fields = [T.StructField(name, type_map[type_name], True) for name, type_name in _FIELD_TYPES.items()]
    return T.StructType(fields)

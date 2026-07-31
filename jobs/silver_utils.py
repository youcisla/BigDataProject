"""Silver-layer utility functions (pyspark-free).

Lets unit tests import helpers without the heavy Spark dependency.
"""

from __future__ import annotations

import hashlib

# Trading/Crypto schema (replaces Reddit I/P)
# Three Bronze sources share these fields. `ticker` is the natural key
# across stocks, crypto_live, and crypto_news.
_FIELD_TYPES = {
    "source": "string",
    "source_type": "string",       # stock_ohlcv | crypto_ohlcv | crypto_news | news | intraday
    "external_id": "string",        # hashable dedup key
    "ticker": "string",              # AAPL | BTC | ETH (uppercased)
    "date": "string",                # YYYY-MM-DD
    # Intraday bars only. Daily rows leave these null, which keeps one schema
    # across every source instead of forking the Silver layer in two.
    "ts": "string",                  # ISO-8601 UTC timestamp of the bar open
    "interval": "string",            # 1m | 5m | 15m | 1h | 1d
    "open": "double",
    "high": "double",
    "low": "double",
    "close": "double",
    "volume": "long",
    "headline": "string",            # news only
    "url": "string",                 # news only
    "publisher": "string",          # news only
    "ingested_at": "string",
}


def row_hash(source: str, external_id: str, ingested_at: str) -> str:
    payload = f"{source}|{external_id}|{ingested_at}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def field_names() -> list[str]:
    return list(_FIELD_TYPES.keys())


def expected_field_types() -> dict[str, str]:
    return dict(_FIELD_TYPES)


def build_schema():
    """Build the Spark StructType from the field name -> type mapping."""
    try:
        from pyspark.sql import types as T  # noqa: WPS433
    except ImportError as exc:
        raise RuntimeError("pyspark not installed; cannot build Spark schema") from exc

    type_map = {
        "string": T.StringType(),
        "double": T.DoubleType(),
        "long": T.LongType(),
    }
    fields = [T.StructField(name, type_map[type_name], True) for name, type_name in _FIELD_TYPES.items()]
    return T.StructType(fields)

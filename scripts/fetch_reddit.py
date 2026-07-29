"""Bronze layer: ingest Reddit data from a bulk dump.

Live PRAW ingestion was removed because Reddit's app registration
policy currently blocks new credential issuance on this account.
The bulk path uses a Kaggle / Arctic Shift / Academic Torrents
dump (~5-10 GB compressed) which satisfies the 5GB+ requirement
in a single load.

Reads a Reddit CSV/ZST dump, parses comments or posts, writes
JSON Lines to HDFS at /data/bronze/reddit/{YYYY-MM-DD}/posts.jsonl.

Usage:
    REDDIT_BULK_PATH=/path/to/reddit_dump.csv.zst python scripts/fetch_reddit.py
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import logging
import os
import sys
from pathlib import Path
from typing import Iterator

# Allow running as `python scripts/fetch_reddit.py` from project root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.upload_to_hdfs import bronze_path, ensure_directory, upload_json_lines  # noqa: E402

logger = logging.getLogger(__name__)


def _safe_int(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _safe_float(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _first(*values):
    """Return the first non-empty string from the given values."""
    for v in values:
        if v is None:
            continue
        if isinstance(v, str) and v.strip() == "":
            continue
        return v
    return None


def _parse_datetime(value) -> float | None:
    """Parse a date string into a Unix timestamp. Handles ISO-ish and Unix-int formats."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        pass
    try:
        from datetime import datetime

        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%fZ"):
            try:
                return datetime.strptime(value, fmt).timestamp()
            except (ValueError, TypeError):
                continue
    except ImportError:
        pass
    return None


def fetch_bulk(csv_path: str) -> Iterator[dict]:
    """Parse a Reddit CSV dump (Kaggle / Arctic Shift / Pushshift format).

    Expected columns (subset, case-insensitive): id, subreddit, author, body, score,
    created_utc. Missing columns are tolerated as None.
    """
    open_fn = open
    if csv_path.endswith(".zst"):
        try:
            import zstandard  # noqa: WPS433
        except ImportError as exc:
            raise SystemExit(
                "zstandard not installed. Run `pip install zstandard` or pre-decompress."
            ) from exc
        dctx = zstandard.ZstdDecompressor()
        open_fn = lambda p, m: (  # noqa: E731
            __import__("io").TextIOWrapper(dctx.stream_reader(open(p, "rb")), encoding="utf-8")
        )

    with open_fn(csv_path, "rt", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            normalized = {k.lower(): v for k, v in row.items() if k}
            yield {
                "source": "reddit",
                "source_type": "reddit_comment",
                "external_id": _first(normalized.get("id"), normalized.get("comment_id"), normalized.get("post_id")),
                "subreddit": normalized.get("subreddit"),
                "author": _first(normalized.get("author"), normalized.get("author_name")),
                "title": _first(normalized.get("title"), normalized.get("post_title")),
                "body": _first(normalized.get("body"), normalized.get("self_text"), normalized.get("post_self_text"), normalized.get("comment")),
                "score": _safe_int(normalized.get("score")),
                "num_comments": None,
                "url": None,
                "created_utc": _parse_datetime(_first(normalized.get("created_utc"), normalized.get("created_time"), normalized.get("post_created_time"))),
                "ingested_at": dt.datetime.utcnow().isoformat(),
            }


def fetch_bulk_multi(paths: list[str]) -> Iterator[dict]:
    """Iterate fetch_bulk across multiple paths (concatenated streams)."""
    for path in paths:
        if not path:
            continue
        yield from fetch_bulk(path)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Ingest Reddit bulk dump into Bronze HDFS."
    )
    parser.add_argument(
        "--date",
        default=dt.date.today().isoformat(),
        help="Partition date (YYYY-MM-DD). Defaults to today UTC.",
    )
    parser.add_argument(
        "--bulk-path",
        action="append",
        default=None,
        help="Path to bulk CSV/ZST dump. Repeat the flag for multiple files. "
             "Defaults to REDDIT_BULK_PATH env (comma-separated supported).",
    )
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(message)s")

    paths = args.bulk_path
    if not paths:
        env_val = os.environ.get("REDDIT_BULK_PATH", "")
        paths = [p.strip() for p in env_val.split(",") if p.strip()]
    if not paths:
        parser.error(
            "--bulk-path or REDDIT_BULK_PATH env required. "
            "Point it to a downloaded Reddit dump (comma-separated for multiple)."
        )

    target = bronze_path("reddit", args.date, "posts.jsonl")
    ensure_directory(f"/data/bronze/reddit/{args.date}")

    count = upload_json_lines(fetch_bulk_multi(paths), target)

    logger.info(
        "Bronze reddit bulk done: %d records from %d file(s) at %s",
        count,
        len(paths),
        target,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

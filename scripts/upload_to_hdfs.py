"""Generic HDFS upload helper used by fetch scripts.

Usage:
    from scripts.upload_to_hdfs import upload_json_lines
    upload_json_lines(records_iter, "/data/bronze/reddit/2026-07-29/posts.jsonl")

Emits PROGRESS lines to stdout for downstream progress tracking:
    PROGRESS records=12345 last_id=abc123
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

PROGRESS_EVERY = 1000


def _local_fallback(hdfs_path: str) -> str:
    """Where a record file lands when HDFS is unreachable.

    Hardcoding /tmp broke on Windows hosts, which the README supports for
    running the ingestion scripts. gettempdir() resolves correctly on both.
    """
    root = Path(os.environ.get("BRONZE_LOCAL_FALLBACK") or tempfile.gettempdir())
    return str(root / hdfs_path.lstrip("/\\"))


def _hdfs_client():
    namenode = os.environ.get("HDFS_NAMENODE", "namenode")
    port = os.environ.get("HDFS_PORT", "9870")
    webhdfs_url = f"http://{namenode}:{port}"

    try:
        from hdfs import InsecureClient

        return InsecureClient(webhdfs_url, user="root")
    except ImportError:
        logger.warning("hdfs library not installed, falling back to local /tmp")
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("HDFS unreachable at %s (%s), using local /tmp", webhdfs_url, exc)
        return None


def upload_json_lines(
    records: Iterable[dict],
    hdfs_path: str,
    progress_callback: Optional[callable] = None,
) -> int:
    """Upload an iterable of records as JSON Lines to HDFS.

    Returns the count of records written. Falls back to /tmp if HDFS unreachable.

    Emits a PROGRESS line every PROGRESS_EVERY records on stdout for downstream
    progress tracking (consumed by dashboard /api/progress).
    """
    client = _hdfs_client()
    target = hdfs_path
    count = 0
    last_id: Optional[str] = None

    if client is None:
        target = _local_fallback(hdfs_path)

    Path(target).parent.mkdir(parents=True, exist_ok=True)

    with open(target, "w", encoding="utf-8") as f:
        for record in records:
            line = json.dumps(record, ensure_ascii=False)
            f.write(line + "\n")
            count += 1
            last_id = str(record.get("external_id") or "")
            if count % PROGRESS_EVERY == 0:
                _emit_progress(count, last_id)
                if progress_callback:
                    progress_callback(count, last_id)

    if client is not None and target != hdfs_path:
        try:
            client.upload(hdfs_path, target, overwrite=True)
        except Exception as exc:  # noqa: BLE001
            logger.warning("HDFS upload failed for %s: %s (kept local copy)", hdfs_path, exc)

    _emit_progress(count, last_id, final=True)
    # Report where the data actually landed, not where we wanted it to land.
    logger.info("Wrote %d records to %s", count, target)
    return count


def _emit_progress(count: int, last_id: str, final: bool = False) -> None:
    """Write a PROGRESS line to stdout. Flushed immediately so the dashboard can poll it."""
    status = "final" if final else "running"
    print(f"PROGRESS records={count} last_id={last_id} status={status}", flush=True)


def ensure_directory(hdfs_path: str) -> None:
    """Create an HDFS directory (and parents) if it does not exist."""
    client = _hdfs_client()
    if client is None:
        Path(_local_fallback(hdfs_path)).mkdir(parents=True, exist_ok=True)
        return
    try:
        client.makedirs(hdfs_path)
    except Exception as exc:  # noqa: BLE001
        if "already exists" not in str(exc).lower():
            logger.warning("mkdir %s failed: %s", hdfs_path, exc)


def bronze_path(source: str, date_str: str, filename: str = "data.jsonl") -> str:
    """Standard HDFS path for Bronze layer: /data/bronze/{source}/{date}/{filename}."""
    return f"/data/bronze/{source}/{date_str}/{filename}"

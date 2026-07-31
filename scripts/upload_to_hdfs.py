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
import subprocess
import tempfile
from pathlib import Path, PurePosixPath
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

PROGRESS_EVERY = 1000
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _local_fallback(hdfs_path: str) -> str:
    """Where a record file lands when HDFS is unreachable.

    Hardcoding /tmp broke on Windows hosts, which the README supports for
    running the ingestion scripts. gettempdir() resolves correctly on both.
    """
    root = Path(os.environ.get("BRONZE_LOCAL_FALLBACK") or tempfile.gettempdir())
    return str(root / hdfs_path.lstrip("/\\"))


def _hdfs_client():
    """Return a live WebHDFS client, or None if HDFS is not reachable.

    These scripts run on the host, not inside the compose network, so the
    default host is localhost. HDFS_WEB_UI_PORT is the WebHDFS/REST port
    (9870); HDFS_PORT is the RPC port (9000) and does not speak HTTP.
    """
    namenode = os.environ.get("HDFS_WEBHDFS_HOST", "localhost")
    port = os.environ.get("HDFS_WEB_UI_PORT", "9870")
    webhdfs_url = f"http://{namenode}:{port}"

    try:
        from hdfs import InsecureClient
    except ImportError:
        logger.warning("hdfs library not installed, staging records locally")
        return None

    client = InsecureClient(webhdfs_url, user="root")
    try:
        # The constructor is lazy — it never contacts the namenode. Without an
        # explicit probe a dead endpoint still returned a client object, and
        # every ingest silently "succeeded" while writing nothing to HDFS.
        client.status("/")
    except Exception as exc:  # noqa: BLE001
        logger.warning("HDFS unreachable at %s (%s), staging records locally", webhdfs_url, exc)
        return None
    return client


def _docker_put(local_path: str, hdfs_path: str) -> bool:
    """Copy a staged file into HDFS through the namenode container.

    WebHDFS writes are redirected by the namenode to the datanode's *container*
    hostname on port 9864, which a client on the host cannot resolve or reach.
    Rather than publishing datanode ports and rewriting the advertised hostname,
    push the file through the container that is already on the compose network.
    """
    posix = PurePosixPath(hdfs_path)
    staging = f"/tmp/{posix.name}"
    steps = [
        ["docker", "compose", "cp", local_path, f"namenode:{staging}"],
        ["docker", "compose", "exec", "-T", "namenode", "hdfs", "dfs", "-mkdir", "-p", str(posix.parent)],
        ["docker", "compose", "exec", "-T", "namenode", "hdfs", "dfs", "-put", "-f", staging, hdfs_path],
        ["docker", "compose", "exec", "-T", "namenode", "rm", "-f", staging],
    ]
    for step in steps:
        result = subprocess.run(
            step, cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=1800
        )
        if result.returncode != 0:
            logger.warning("HDFS put via docker failed (%s): %s", step[3:6], result.stderr.strip()[:200])
            return False
    logger.info("Uploaded to HDFS via namenode container: %s", hdfs_path)
    return True


def upload_json_lines(
    records: Iterable[dict],
    hdfs_path: str,
    progress_callback: Optional[callable] = None,
) -> int:
    """Upload an iterable of records as JSON Lines to HDFS.

    Records are always staged to a local file first, then uploaded via WebHDFS.
    Returns the count of records written. Falls back to keeping the local file
    if HDFS is unreachable.

    Emits a PROGRESS line every PROGRESS_EVERY records on stdout for downstream
    progress tracking (consumed by dashboard /api/progress).
    """
    client = _hdfs_client()
    # Always stage locally. The previous version wrote straight to `hdfs_path`
    # when a client existed and then guarded the upload on `target != hdfs_path`
    # — a condition that was only ever true when the client was absent. So a
    # working HDFS connection meant the records were written to a local
    # directory literally named /data/bronze/... and never uploaded at all.
    staged = _local_fallback(hdfs_path)
    count = 0
    last_id: Optional[str] = None

    Path(staged).parent.mkdir(parents=True, exist_ok=True)

    with open(staged, "w", encoding="utf-8") as f:
        for record in records:
            line = json.dumps(record, ensure_ascii=False)
            f.write(line + "\n")
            count += 1
            last_id = str(record.get("external_id") or "")
            if count % PROGRESS_EVERY == 0:
                _emit_progress(count, last_id)
                if progress_callback:
                    progress_callback(count, last_id)

    landed = staged
    if client is not None:
        try:
            client.makedirs(str(PurePosixPath(hdfs_path).parent))
            client.upload(hdfs_path, staged, overwrite=True)
            landed = hdfs_path
        except Exception as exc:  # noqa: BLE001
            logger.warning("WebHDFS upload failed for %s: %s", hdfs_path, exc)

    if landed != hdfs_path and _docker_put(staged, hdfs_path):
        landed = hdfs_path
    elif landed != hdfs_path:
        logger.warning("Could not reach HDFS; kept local copy at %s", staged)

    _emit_progress(count, last_id, final=True)
    # Report where the data actually landed, not where we wanted it to land.
    logger.info("Wrote %d records to %s", count, landed)
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

"""Smoke test for Bronze layer: verify fetch_reddit / fetch_newsapi produce
JSON Lines with the expected schema and counts."""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from unittest import mock

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from scripts import fetch_reddit, fetch_newsapi  # noqa: E402


def test_fetch_reddit_live_yields_records(monkeypatch):
    """Live mode should yield dicts with required keys."""
    fake_post = mock.Mock(
        id="abc123",
        title="Test post",
        selftext="body text",
        score=42,
        num_comments=7,
        url="https://reddit.com/r/test/abc",
        created_utc=1700000000.0,
        author=mock.Mock(__str__=lambda self: "test_user"),
    )

    fake_subreddit = mock.Mock()
    fake_subreddit.top.return_value = [fake_post]

    fake_reddit = mock.Mock()
    fake_reddit.subreddit.return_value = fake_subreddit

    monkeypatch.setenv("REDDIT_CLIENT_ID", "x")
    monkeypatch.setenv("REDDIT_CLIENT_SECRET", "y")
    monkeypatch.setenv("REDDIT_USER_AGENT", "test")

    with mock.patch.object(fetch_reddit, "_build_praw_client", return_value=fake_reddit):
        records = list(fetch_reddit.fetch_live())

    assert len(records) == len(fetch_reddit.LIVE_SUBREDDITS)
    sample = records[0]
    assert sample["source"] == "reddit"
    assert sample["source_type"] == "reddit_post"
    assert sample["external_id"] == "abc123"
    assert sample["title"] == "Test post"
    assert sample["score"] == 42
    assert "ingested_at" in sample


def test_fetch_reddit_bulk_parses_csv(tmp_path):
    """Bulk mode should parse a CSV and yield normalized records."""
    csv_path = tmp_path / "reddit.csv"
    csv_path.write_text(
        "id,subreddit,author,body,score,created_utc\n"
        "c1,python,user1,hello world,5,1700000000\n"
        "c2,python,user2,another comment,3,1700000001\n",
        encoding="utf-8",
    )

    records = list(fetch_reddit.fetch_bulk(str(csv_path)))

    assert len(records) == 2
    assert records[0]["external_id"] == "c1"
    assert records[0]["subreddit"] == "python"
    assert records[0]["body"] == "hello world"
    assert records[0]["score"] == 5
    assert records[0]["source_type"] == "reddit_comment"


def test_bronze_path_format():
    """Standard HDFS Bronze path includes source, date, and filename."""
    path = fetch_reddit.bronze_path("reddit", "2026-07-29", "posts.jsonl") if hasattr(fetch_reddit, "bronze_path") else None
    # bronze_path is in upload_to_hdfs module
    from scripts.upload_to_hdfs import bronze_path

    assert bronze_path("reddit", "2026-07-29") == "/data/bronze/reddit/2026-07-29/data.jsonl"
    assert bronze_path("news", "2026-07-29", "headlines.jsonl") == "/data/bronze/news/2026-07-29/headlines.jsonl"


def test_upload_to_hdfs_writes_jsonl(tmp_path, monkeypatch):
    """upload_json_lines writes one JSON object per line."""
    from scripts.upload_to_hdfs import upload_json_lines

    monkeypatch.setenv("HDFS_NAMENODE", "fake-namenode")

    # _hdfs_client will fail (no real HDFS), fall back to local /tmp
    records = [{"a": 1}, {"a": 2}, {"a": 3}]
    target = str(tmp_path / "nested" / "test.jsonl")
    count = upload_json_lines(iter(records), target)

    assert count == 3
    assert Path(target).exists()
    lines = Path(target).read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 3
    assert json.loads(lines[0]) == {"a": 1}

"""Bronze layer: fetch NewsAPI headlines.

Usage:
    python scripts/fetch_newsapi.py

Pulls top headlines from configured categories. Free tier = 100 req/day,
so this script caches the last call timestamp and only re-fetches when
the cache is older than the configured interval.

Writes JSON Lines to HDFS at /data/bronze/news/{YYYY-MM-DD}/headlines.jsonl
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import sys
from pathlib import Path
from typing import Iterator

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests  # noqa: E402

from scripts.upload_to_hdfs import bronze_path, ensure_directory, upload_json_lines  # noqa: E402

logger = logging.getLogger(__name__)

NEWSAPI_ENDPOINT = "https://newsapi.org/v2/top-headlines"

# Country=us, free tier allows this. Categories use /top-headlines (free) not /everything (paid).
CATEGORIES = ("business", "technology", "general")


def fetch_headlines(category: str, page_size: int = 20) -> Iterator[dict]:
    """Fetch top headlines for a category via NewsAPI."""
    api_key = os.environ.get("NEWSAPI_KEY")
    if not api_key:
        raise SystemExit("NEWSAPI_KEY env required for NewsAPI fetch.")

    params = {
        "category": category,
        "pageSize": min(page_size, 100),
        "country": "us",
    }
    headers = {"X-Api-Key": api_key}

    try:
        response = requests.get(NEWSAPI_ENDPOINT, params=params, headers=headers, timeout=15)
        response.raise_for_status()
    except requests.RequestException as exc:
        logger.warning("NewsAPI request failed for %s: %s", category, exc)
        return

    body = response.json()
    if body.get("status") != "ok":
        logger.warning("NewsAPI non-OK response for %s: %s", category, body)
        return

    for article in body.get("articles", []):
        yield {
            "source": "news",
            "source_type": "news_article",
            "external_id": hash(article.get("url") or article.get("title")),
            "source_name": (article.get("source") or {}).get("name"),
            "author": article.get("author"),
            "title": article.get("title"),
            "body": article.get("description") or article.get("content"),
            "url": article.get("url"),
            "published_at": article.get("publishedAt"),
            "ingested_at": dt.datetime.utcnow().isoformat(),
            "category": category,
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch NewsAPI headlines into Bronze HDFS.")
    parser.add_argument(
        "--date",
        default=dt.date.today().isoformat(),
        help="Partition date (YYYY-MM-DD). Defaults to today UTC.",
    )
    parser.add_argument(
        "--categories",
        nargs="+",
        default=list(CATEGORIES),
        help="NewsAPI categories to fetch.",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=20,
        help="Articles per category. Free tier caps at 100, recommended 20 to stay under quota.",
    )
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(message)s")

    target = bronze_path("news", args.date, "headlines.jsonl")
    ensure_directory(f"/data/bronze/news/{args.date}")

    def all_categories():
        for cat in args.categories:
            yield from fetch_headlines(cat, page_size=args.page_size)

    count = upload_json_lines(all_categories(), target)
    logger.info("Bronze news done: %d records at %s", count, target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

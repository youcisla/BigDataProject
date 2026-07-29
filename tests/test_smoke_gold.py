"""Smoke test for Gold layer: verify VADER scoring + Postgres URL construction."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from jobs import gold_kpis  # noqa: E402


def test_vader_returns_compound_in_range():
    """VADER UDF returns compound score in [-1, 1]."""
    analyzer = SentimentIntensityAnalyzer()
    score = analyzer.polarity_scores("I love this great product!")["compound"]
    assert -1.0 <= score <= 1.0
    assert score > 0.5  # clearly positive


def test_vader_handles_empty_text():
    """Empty text returns 0.0 (neutral)."""
    analyzer = SentimentIntensityAnalyzer()
    score = analyzer.polarity_scores("")["compound"]
    assert score == 0.0


def test_vader_negative_text():
    """Negative text returns negative score."""
    analyzer = SentimentIntensityAnalyzer()
    score = analyzer.polarity_scores("This is terrible, awful, horrible.")["compound"]
    assert score < -0.5


def test_postgres_url_from_env(monkeypatch):
    """PG_URL is built from env vars."""
    monkeypatch.setenv("POSTGRES_HOST", "test-host")
    monkeypatch.setenv("POSTGRES_PORT", "5433")
    monkeypatch.setenv("POSTGRES_DB", "test-db")
    monkeypatch.setenv("POSTGRES_USER", "u")
    monkeypatch.setenv("POSTGRES_PASSWORD", "p")

    # Re-import to pick up new env
    import importlib

    importlib.reload(gold_kpis)
    assert "test-host:5433/test-db" in gold_kpis.PG_URL
    assert gold_kpis.PG_URL.startswith("jdbc:postgresql://")

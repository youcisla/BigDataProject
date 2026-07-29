-- Gold schema DDL. Run after init.sql on first pipeline init.
-- Creates partitioned tables for KPIs.

SET search_path TO gold, public;

-- ============================================================================
-- sentiment_daily : average VADER sentiment per source per day
-- ============================================================================
DROP TABLE IF EXISTS gold.sentiment_daily CASCADE;
CREATE TABLE gold.sentiment_daily (
    date           DATE        NOT NULL,
    source         TEXT        NOT NULL,
    source_type    TEXT        NOT NULL,
    avg_sentiment  NUMERIC(6,4) NOT NULL,
    record_count   INTEGER     NOT NULL,
    updated_at     TIMESTAMP   NOT NULL DEFAULT now(),
    PRIMARY KEY (date, source, source_type)
) PARTITION BY RANGE (date);

CREATE TABLE gold.sentiment_daily_default PARTITION OF gold.sentiment_daily DEFAULT;

-- ============================================================================
-- mention_volume : post/comment/article counts per source per day
-- ============================================================================
DROP TABLE IF EXISTS gold.mention_volume CASCADE;
CREATE TABLE gold.mention_volume (
    date          DATE    NOT NULL,
    source        TEXT    NOT NULL,
    source_type   TEXT    NOT NULL,
    mention_count INTEGER NOT NULL,
    updated_at    TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (date, source, source_type)
) PARTITION BY RANGE (date);

CREATE TABLE gold.mention_volume_default PARTITION OF gold.mention_volume DEFAULT;

-- ============================================================================
-- top_entities : top subreddits and news sources per 7-day window
-- ============================================================================
DROP TABLE IF EXISTS gold.top_entities CASCADE;
CREATE TABLE gold.top_entities (
    window_end    DATE    NOT NULL,
    entity_type   TEXT    NOT NULL,  -- 'subreddit' or 'source_name'
    entity_name   TEXT    NOT NULL,
    mention_count INTEGER NOT NULL,
    avg_sentiment NUMERIC(6,4),
    updated_at    TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (window_end, entity_type, entity_name)
) PARTITION BY RANGE (window_end);

CREATE TABLE gold.top_entities_default PARTITION OF gold.top_entities DEFAULT;

-- ============================================================================
-- sentiment_trend_7d : 7-day moving average of sentiment per source
-- ============================================================================
DROP TABLE IF EXISTS gold.sentiment_trend_7d CASCADE;
CREATE TABLE gold.sentiment_trend_7d (
    date           DATE    NOT NULL,
    source         TEXT    NOT NULL,
    avg_sentiment_7d NUMERIC(6,4) NOT NULL,
    updated_at     TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (date, source)
) PARTITION BY RANGE (date);

CREATE TABLE gold.sentiment_trend_7d_default PARTITION OF gold.sentiment_trend_7d DEFAULT;

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_sentiment_daily_date ON gold.sentiment_daily(date);
CREATE INDEX IF NOT EXISTS idx_mention_volume_date ON gold.mention_volume(date);
CREATE INDEX IF NOT EXISTS idx_top_entities_window ON gold.top_entities(window_end);
CREATE INDEX IF NOT EXISTS idx_trend_7d_date ON gold.sentiment_trend_7d(date);

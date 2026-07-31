-- Gold schema DDL. Run after init.sql on first pipeline init.
-- Creates partitioned tables for the trading/crypto KPI suite.
-- See sql/gold_schema.sql for full DDL.

SET search_path TO gold, public;

-- ============================================================================
-- daily_prices : OHLCV per ticker per day (from Silver)
-- ============================================================================
DROP TABLE IF EXISTS gold.daily_prices CASCADE;
CREATE TABLE gold.daily_prices (
    date        DATE        NOT NULL,
    ticker      TEXT        NOT NULL,
    source      TEXT        NOT NULL,
    open        NUMERIC(18,8),
    high        NUMERIC(18,8),
    low         NUMERIC(18,8),
    close       NUMERIC(18,8) NOT NULL,
    volume      BIGINT,
    updated_at  TIMESTAMP   NOT NULL DEFAULT now(),
    PRIMARY KEY (date, ticker, source)
) PARTITION BY RANGE (date);

CREATE TABLE gold.daily_prices_default PARTITION OF gold.daily_prices DEFAULT;

-- ============================================================================
-- daily_returns : pct change vs prev trading day, per ticker
-- ============================================================================
DROP TABLE IF EXISTS gold.daily_returns CASCADE;
CREATE TABLE gold.daily_returns (
    date        DATE        NOT NULL,
    ticker      TEXT        NOT NULL,
    return_pct  NUMERIC(10,6) NOT NULL,
    updated_at  TIMESTAMP   NOT NULL DEFAULT now(),
    PRIMARY KEY (date, ticker)
) PARTITION BY RANGE (date);

CREATE TABLE gold.daily_returns_default PARTITION OF gold.daily_returns DEFAULT;

-- ============================================================================
-- top_movers : daily top 10 gainers + losers
-- ============================================================================
DROP TABLE IF EXISTS gold.top_movers CASCADE;
CREATE TABLE gold.top_movers (
    date        DATE        NOT NULL,
    ticker      TEXT        NOT NULL,
    direction   TEXT        NOT NULL,  -- 'gain' | 'loss'
    rank        INTEGER     NOT NULL,
    return_pct  NUMERIC(10,6) NOT NULL,
    close       NUMERIC(18,8),
    updated_at  TIMESTAMP   NOT NULL DEFAULT now(),
    PRIMARY KEY (date, direction, rank)
) PARTITION BY RANGE (date);

CREATE TABLE gold.top_movers_default PARTITION OF gold.top_movers DEFAULT;

-- ============================================================================
-- rolling_volatility_7d : 7-day rolling stddev of returns per ticker
-- ============================================================================
DROP TABLE IF EXISTS gold.rolling_volatility_7d CASCADE;
CREATE TABLE gold.rolling_volatility_7d (
    date          DATE        NOT NULL,
    ticker        TEXT        NOT NULL,
    volatility    NUMERIC(12,8),
    sample_size   INTEGER,
    updated_at    TIMESTAMP   NOT NULL DEFAULT now(),
    PRIMARY KEY (date, ticker)
) PARTITION BY RANGE (date);

CREATE TABLE gold.rolling_volatility_7d_default PARTITION OF gold.rolling_volatility_7d DEFAULT;

-- ============================================================================
-- news_volume_per_coin : daily headline counts per ticker
-- ============================================================================
DROP TABLE IF EXISTS gold.news_volume_per_coin CASCADE;
CREATE TABLE gold.news_volume_per_coin (
    date          DATE    NOT NULL,
    ticker        TEXT    NOT NULL,
    headline_count INTEGER NOT NULL,
    updated_at    TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (date, ticker)
) PARTITION BY RANGE (date);

CREATE TABLE gold.news_volume_per_coin_default PARTITION OF gold.news_volume_per_coin DEFAULT;

-- ============================================================================
-- news_headlines : the headline text itself, for the dashboard
-- The dashboard cannot read Bronze over WebHDFS — the namenode redirects reads
-- to the datanode's container hostname, which is unreachable from the host.
-- Serving the text from the warehouse keeps the dashboard on one data source.
-- ============================================================================
DROP TABLE IF EXISTS gold.news_headlines CASCADE;
CREATE TABLE gold.news_headlines (
    date            DATE    NOT NULL,
    ticker          TEXT    NOT NULL,
    headline        TEXT    NOT NULL,
    url             TEXT,
    source          TEXT,
    sentiment       NUMERIC(6,4),
    sentiment_label TEXT,
    updated_at  TIMESTAMP NOT NULL DEFAULT now()
) PARTITION BY RANGE (date);

CREATE TABLE gold.news_headlines_default PARTITION OF gold.news_headlines DEFAULT;

-- ============================================================================
-- silver_sample : a bounded slice of the Silver layer, for the UI
-- Silver is Parquet on HDFS. The dashboard speaks SQL, so publish a sample
-- here to keep every Medallion layer inspectable from one place.
-- ============================================================================
DROP TABLE IF EXISTS gold.silver_sample CASCADE;
CREATE TABLE gold.silver_sample (
    source_type TEXT NOT NULL,
    source      TEXT,
    external_id TEXT,
    ticker      TEXT,
    date        DATE,
    open        NUMERIC(18,8),
    high        NUMERIC(18,8),
    low         NUMERIC(18,8),
    close       NUMERIC(18,8),
    volume      BIGINT,
    headline    TEXT,
    ingested_at TEXT,
    updated_at  TIMESTAMP NOT NULL DEFAULT now()
);

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_news_headlines_ticker ON gold.news_headlines(ticker, date DESC);
CREATE INDEX IF NOT EXISTS idx_silver_sample_type ON gold.silver_sample(source_type);
CREATE INDEX IF NOT EXISTS idx_daily_prices_ticker ON gold.daily_prices(ticker);
CREATE INDEX IF NOT EXISTS idx_daily_returns_ticker ON gold.daily_returns(ticker);
CREATE INDEX IF NOT EXISTS idx_top_movers_date ON gold.top_movers(date);
CREATE INDEX IF NOT EXISTS idx_volatility_date ON gold.rolling_volatility_7d(date);
CREATE INDEX IF NOT EXISTS idx_news_volume_date ON gold.news_volume_per_coin(date);


-- ============================================================================
-- news_sentiment_daily : daily news tone per ticker, joined to that day's
-- return. One row per (date, ticker) so SQL can correlate tone with price.
-- ============================================================================
DROP TABLE IF EXISTS gold.news_sentiment_daily CASCADE;
CREATE TABLE gold.news_sentiment_daily (
    date           DATE    NOT NULL,
    ticker         TEXT    NOT NULL,
    avg_sentiment  NUMERIC(6,4),
    headline_count INTEGER NOT NULL,
    positive_count INTEGER,
    negative_count INTEGER,
    return_pct     NUMERIC(12,6),
    updated_at     TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (date, ticker)
);

CREATE INDEX IF NOT EXISTS idx_news_sentiment_ticker ON gold.news_sentiment_daily(ticker, date DESC);


-- ============================================================================
-- intraday_prices : sub-daily OHLCV bars, so the chart can offer 1m..1h
-- timeframes. The Kaggle archive is daily-only; these come from the Yahoo
-- chart API. Not partitioned: the window is short by construction (Yahoo caps
-- 1m at 7 days, 5m/15m at 60, 1h at 730).
-- ============================================================================
DROP TABLE IF EXISTS gold.intraday_prices CASCADE;
CREATE TABLE gold.intraday_prices (
    ticker     TEXT        NOT NULL,
    ts         TIMESTAMPTZ NOT NULL,
    interval   TEXT        NOT NULL,
    date       DATE,
    open       NUMERIC(18,8),
    high       NUMERIC(18,8),
    low        NUMERIC(18,8),
    close      NUMERIC(18,8) NOT NULL,
    volume     BIGINT,
    updated_at TIMESTAMP   NOT NULL DEFAULT now(),
    PRIMARY KEY (ticker, ts, interval)
);

CREATE INDEX IF NOT EXISTS idx_intraday_lookup ON gold.intraday_prices(ticker, interval, ts DESC);

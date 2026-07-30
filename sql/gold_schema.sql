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

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_daily_prices_ticker ON gold.daily_prices(ticker);
CREATE INDEX IF NOT EXISTS idx_daily_returns_ticker ON gold.daily_returns(ticker);
CREATE INDEX IF NOT EXISTS idx_top_movers_date ON gold.top_movers(date);
CREATE INDEX IF NOT EXISTS idx_volatility_date ON gold.rolling_volatility_7d(date);
CREATE INDEX IF NOT EXISTS idx_news_volume_date ON gold.news_volume_per_coin(date);

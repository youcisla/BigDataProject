/**
 * Data access layer for the dashboard.
 *
 * Two sources:
 * - HDFS WebHDFS for raw OHLCV + news headlines (Silver Parquet + Bronze JSONL)
 * - Postgres for KPIs (daily_returns, top_movers, rolling_volatility_7d, news_volume_per_coin)
 *
 * Reads are designed to be cheap: limited row counts, server-side aggregation
 * where possible, streaming JSON parsing for large WebHDFS responses.
 */

import { Pool } from "pg";

const HDFS_NAMENODE = process.env.HDFS_NAMENODE ?? "localhost";
const HDFS_PORT = process.env.HDFS_PORT ?? "9870";
const HDFS_BASE = `http://${HDFS_NAMENODE}:${HDFS_PORT}/webhdfs/v1`;

/**
 * One shared pool for the process. Every query used to open and tear down its
 * own Client, so a single page load paid a TCP connect + auth handshake per
 * chart — and the comparison view paid it three times per ticker.
 *
 * Stashed on globalThis because Next.js dev mode re-evaluates modules on hot
 * reload, which would otherwise leak a pool per edit.
 */
const globalForPg = globalThis as unknown as { __goldPool?: Pool };

const pool =
  globalForPg.__goldPool ??
  new Pool({
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: parseInt(process.env.POSTGRES_PORT ?? "5432", 10),
    database: process.env.POSTGRES_DB ?? "gold",
    user: process.env.POSTGRES_USER ?? "gold",
    password: process.env.POSTGRES_PASSWORD ?? "gold",
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

// A pool emits 'error' for idle clients dropped by the server. Unhandled, that
// event crashes the Node process.
pool.on("error", (err) => console.error("gold pool error:", err.message));

if (process.env.NODE_ENV !== "production") globalForPg.__goldPool = pool;

export interface OhlcvRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  source: string;
}

export interface Headline {
  date: string;
  ticker: string;
  headline: string;
  source: string;
}

export interface TickerSummary {
  ticker: string;
  source: string;
  ohlcv_rows: number;
  news_rows: number;
  first_date: string;
  last_date: string;
  latest_close: number | null;
}

async function webhdfs_get(path: string, params: Record<string, string>): Promise<Response> {
  const url = new URL(`${HDFS_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`WebHDFS ${path} returned ${res.status}`);
  return res;
}

/** List all tickers available in the Gold layer, with row counts and date ranges. */
export async function listSymbols(): Promise<TickerSummary[]> {
  // Single pass over daily_prices. The previous version ran a correlated
  // subquery per (ticker, source) group to find the latest close — one extra
  // scan per group across ~1.7M rows. DISTINCT ON gets it in the same scan.
  try {
    const result = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (ticker, source) ticker, source, close
        FROM gold.daily_prices
        ORDER BY ticker, source, date DESC
      ),
      agg AS (
        SELECT ticker, source,
               COUNT(*)::int AS ohlcv_rows,
               MIN(date)::text AS first_date,
               MAX(date)::text AS last_date
        FROM gold.daily_prices
        GROUP BY ticker, source
      ),
      news AS (
        SELECT ticker, COALESCE(SUM(headline_count), 0)::int AS news_rows
        FROM gold.news_volume_per_coin
        GROUP BY ticker
      )
      SELECT agg.ticker, agg.source, agg.ohlcv_rows, agg.first_date, agg.last_date,
             latest.close AS latest_close,
             COALESCE(news.news_rows, 0) AS news_rows
      FROM agg
      JOIN latest USING (ticker, source)
      LEFT JOIN news ON news.ticker = agg.ticker
      ORDER BY agg.ticker, agg.source
    `);

    return result.rows.map((r) => ({
      ticker: r.ticker,
      source: r.source,
      ohlcv_rows: r.ohlcv_rows,
      news_rows: r.news_rows,
      first_date: r.first_date,
      last_date: r.last_date,
      latest_close: r.latest_close != null ? parseFloat(r.latest_close) : null,
    }));
  } catch (err) {
    console.error("listSymbols Postgres error:", err);
    return [];
  }
}

/** Fetch OHLCV rows for a single ticker from the Gold daily_prices table. */
export async function getOhlcv(ticker: string, limit = 1000): Promise<OhlcvRow[]> {
  try {
    const result = await pool.query(
      `SELECT date::text, open, high, low, close, volume, source
       FROM gold.daily_prices
       WHERE ticker = $1
       ORDER BY date DESC
       LIMIT $2`,
      [ticker.toUpperCase(), limit]
    );
    return result.rows
      .map((r) => ({
        date: r.date,
        open: parseFloat(r.open),
        high: parseFloat(r.high),
        low: parseFloat(r.low),
        close: parseFloat(r.close),
        volume: r.volume != null ? parseInt(r.volume, 10) : null,
        source: r.source,
      }))
      .reverse(); // chronological order for charts
  } catch (err) {
    console.error(`getOhlcv(${ticker}) error:`, err);
    return [];
  }
}

/**
 * Fetch news headlines for a ticker from the Gold layer.
 *
 * Reads Postgres, not HDFS: the namenode redirects WebHDFS reads to the
 * datanode's container hostname, which does not resolve from the host, so the
 * previous Bronze-JSONL path always came back empty.
 */
export async function getHeadlines(ticker: string, limit = 50): Promise<Headline[]> {
  try {
    const result = await pool.query(
      `SELECT date::text, ticker, headline, source
       FROM gold.news_headlines
       WHERE ticker = $1
       ORDER BY date DESC
       LIMIT $2`,
      [ticker.toUpperCase(), limit]
    );
    return result.rows.map((r) => ({
      date: r.date,
      ticker: r.ticker,
      headline: r.headline ?? "",
      source: r.source ?? "",
    }));
  } catch (err) {
    console.error(`getHeadlines(${ticker}) error:`, err);
    return [];
  }
}

/** Most frequent headline terms across several tickers — backs the word cloud. */
export async function getHeadlineTerms(
  tickers: string[],
  topN = 60,
): Promise<{ text: string; value: number }[]> {
  try {
    // Tokenize in the database so only the aggregate crosses the wire.
    const result = await pool.query(
      `SELECT word AS text, COUNT(*)::int AS value
       FROM (
         SELECT REGEXP_SPLIT_TO_TABLE(LOWER(headline), '[^a-z'']+') AS word
         FROM gold.news_headlines
         WHERE ticker = ANY($1::text[])
       ) t
       WHERE LENGTH(word) >= 3 AND NOT (word = ANY($2::text[]))
       GROUP BY word
       ORDER BY value DESC
       LIMIT $3`,
      [tickers.map((t) => t.toUpperCase()), Array.from(STOPWORDS), topN]
    );
    return result.rows.map((r) => ({ text: r.text, value: r.value }));
  } catch (err) {
    console.error("getHeadlineTerms error:", err);
    return [];
  }
}

const STOPWORDS = new Set(
  ("the and for that with this from you your are was were has have had not but all can its it's" +
    " will would could should about into over after before more most other some such only than then" +
    " they them their there these those what when where which who whom why how out off don't doesn't" +
    " new now says said say get gets got one two per via amid says top says-it").split(/\s+/),
);

/** Fetch daily returns for a set of tickers, used for cross-symbol charts. */
export async function getDailyReturns(tickers: string[], days = 90): Promise<{ ticker: string; date: string; return_pct: number }[]> {
  try {
    // Rank within each ticker. A plain `ORDER BY date DESC LIMIT days*n` let a
    // single ticker with a longer history consume the entire budget, leaving
    // the others with no overlapping dates — and a correlation matrix of zeros.
    const result = await pool.query(
      `SELECT ticker, date, return_pct FROM (
         SELECT ticker, date::text AS date, return_pct,
                ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn
         FROM gold.daily_returns
         WHERE ticker = ANY($1::text[])
       ) t
       WHERE rn <= $2
       ORDER BY date DESC`,
      [tickers.map((t) => t.toUpperCase()), days]
    );
    return result.rows.map((r) => ({
      ticker: r.ticker,
      date: r.date,
      return_pct: parseFloat(r.return_pct),
    }));
  } catch (err) {
    console.error("getDailyReturns error:", err);
    return [];
  }
}

/** Latest close + volume per ticker over a window — backs the bubble map. */
export async function getRecentPrices(
  tickers: string[],
  days = 90,
): Promise<{ ticker: string; date: string; close: number; volume: number | null }[]> {
  try {
    const result = await pool.query(
      `SELECT ticker, date, close, volume FROM (
         SELECT ticker, date::text AS date, close, volume,
                ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn
         FROM gold.daily_prices
         WHERE ticker = ANY($1::text[])
       ) t
       WHERE rn <= $2
       ORDER BY date DESC`,
      [tickers.map((t) => t.toUpperCase()), days]
    );
    return result.rows.map((r) => ({
      ticker: r.ticker,
      date: r.date,
      close: parseFloat(r.close),
      volume: r.volume != null ? parseInt(r.volume, 10) : null,
    }));
  } catch (err) {
    console.error("getRecentPrices error:", err);
    return [];
  }
}

/** Compute Pearson correlation between daily returns of multiple tickers. */
export function computeCorrelationMatrix(
  returns: { ticker: string; date: string; return_pct: number }[]
): { tickers: string[]; matrix: number[][] } {
  const tickers = Array.from(new Set(returns.map((r) => r.ticker))).sort();
  const byDateTicker = new Map<string, Map<string, number>>();
  for (const r of returns) {
    if (!byDateTicker.has(r.date)) byDateTicker.set(r.date, new Map());
    byDateTicker.get(r.date)!.set(r.ticker, r.return_pct);
  }
  const dates = Array.from(byDateTicker.keys()).sort();
  const matrix: number[][] = tickers.map(() => tickers.map(() => 0));
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i; j < tickers.length; j++) {
      const a: number[] = [];
      const b: number[] = [];
      for (const d of dates) {
        const va = byDateTicker.get(d)?.get(tickers[i]);
        const vb = byDateTicker.get(d)?.get(tickers[j]);
        if (va != null && vb != null) {
          a.push(va);
          b.push(vb);
        }
      }
      if (a.length < 2) {
        matrix[i][j] = matrix[j][i] = 0;
      } else {
        const ma = a.reduce((s, v) => s + v, 0) / a.length;
        const mb = b.reduce((s, v) => s + v, 0) / b.length;
        let num = 0, da = 0, db = 0;
        for (let k = 0; k < a.length; k++) {
          num += (a[k] - ma) * (b[k] - mb);
          da += (a[k] - ma) ** 2;
          db += (b[k] - mb) ** 2;
        }
        const denom = Math.sqrt(da * db);
        const corr = denom === 0 ? 0 : num / denom;
        matrix[i][j] = matrix[j][i] = parseFloat(corr.toFixed(4));
      }
    }
  }
  return { tickers, matrix };
}

/** Aggregate metrics per ticker for comparison view. */
export interface ComparisonMetrics {
  ticker: string;
  mean_return: number | null;
  volatility: number | null;
  total_news: number;
  latest_close: number | null;
}

export async function getComparisonMetrics(tickers: string[]): Promise<ComparisonMetrics[]> {
  const upper = tickers.map((t) => t.toUpperCase());
  try {
    // One round trip for every ticker and every metric. This used to issue
    // three sequential queries per ticker — 18 round trips for a 6-way compare.
    const result = await pool.query(
      `WITH t AS (SELECT UNNEST($1::text[]) AS ticker),
       ret AS (
         SELECT ticker, AVG(return_pct) AS mean_return, STDDEV_SAMP(return_pct) AS volatility
         FROM gold.daily_returns WHERE ticker = ANY($1::text[]) GROUP BY ticker
       ),
       px AS (
         SELECT DISTINCT ON (ticker) ticker, close
         FROM gold.daily_prices WHERE ticker = ANY($1::text[])
         ORDER BY ticker, date DESC
       ),
       news AS (
         SELECT ticker, COALESCE(SUM(headline_count), 0)::int AS n
         FROM gold.news_volume_per_coin WHERE ticker = ANY($1::text[]) GROUP BY ticker
       )
       SELECT t.ticker, ret.mean_return, ret.volatility, px.close AS latest_close,
              COALESCE(news.n, 0) AS total_news
       FROM t
       LEFT JOIN ret USING (ticker)
       LEFT JOIN px USING (ticker)
       LEFT JOIN news USING (ticker)`,
      [upper]
    );

    const byTicker = new Map(result.rows.map((r) => [r.ticker, r]));
    // Preserve the caller's ordering so charts line up with the selection.
    return upper.map((ticker) => {
      const r = byTicker.get(ticker);
      return {
        ticker,
        mean_return: r?.mean_return != null ? parseFloat(r.mean_return) : null,
        volatility: r?.volatility != null ? parseFloat(r.volatility) : null,
        total_news: r?.total_news ?? 0,
        latest_close: r?.latest_close != null ? parseFloat(r.latest_close) : null,
      };
    });
  } catch (err) {
    console.error("getComparisonMetrics error:", err);
    return [];
  }
}

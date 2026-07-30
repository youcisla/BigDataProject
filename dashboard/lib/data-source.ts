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

import { Client } from "pg";

const HDFS_NAMENODE = process.env.HDFS_NAMENODE ?? "localhost";
const HDFS_PORT = process.env.HDFS_PORT ?? "9870";
const HDFS_BASE = `http://${HDFS_NAMENODE}:${HDFS_PORT}/webhdfs/v1`;

const PG = {
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: parseInt(process.env.POSTGRES_PORT ?? "5432", 10),
  database: process.env.POSTGRES_DB ?? "gold",
  user: process.env.POSTGRES_USER ?? "gold",
  password: process.env.POSTGRES_PASSWORD ?? "gold",
};

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

/** List all tickers available in the Silver layer, with row counts and date ranges. */
export async function listSymbols(): Promise<TickerSummary[]> {
  // Query the Postgres Gold tables — they're already aggregated per (date, ticker).
  // Falls back to empty array if Postgres is unreachable.
  const client = new Client(PG);
  try {
    await client.connect();
    const result = await client.query(`
      SELECT
        ticker,
        source,
        COUNT(*)::int AS ohlcv_rows,
        MIN(date)::text AS first_date,
        MAX(date)::text AS last_date,
        (SELECT close FROM gold.daily_prices dp2
         WHERE dp2.ticker = dp.ticker AND dp2.source = dp.source
         ORDER BY date DESC LIMIT 1) AS latest_close
      FROM gold.daily_prices dp
      GROUP BY ticker, source
      ORDER BY ticker, source
    `);
    const tickers = result.rows.map((r) => ({
      ticker: r.ticker,
      source: r.source,
      ohlcv_rows: r.ohlcv_rows,
      news_rows: 0,
      first_date: r.first_date,
      last_date: r.last_date,
      latest_close: r.latest_close != null ? parseFloat(r.latest_close) : null,
    }));

    // Augment with news counts from crypto news (limited to crypto tickers)
    const newsResult = await client.query(`
      SELECT ticker, COUNT(*)::int AS n
      FROM gold.news_volume_per_coin
      GROUP BY ticker
    `);
    const newsMap = new Map<string, number>();
    for (const r of newsResult.rows) newsMap.set(r.ticker, r.n);
    for (const t of tickers) {
      t.news_rows = newsMap.get(t.ticker) ?? 0;
    }
    return tickers;
  } catch (err) {
    console.error("listSymbols Postgres error:", err);
    return [];
  } finally {
    await client.end();
  }
}

/** Fetch OHLCV rows for a single ticker from the Gold daily_prices table. */
export async function getOhlcv(ticker: string, limit = 1000): Promise<OhlcvRow[]> {
  const client = new Client(PG);
  try {
    await client.connect();
    const result = await client.query(
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
  } finally {
    await client.end();
  }
}

/** Fetch news headlines for a ticker from the Silver news partition (HDFS WebHDFS). */
export async function getHeadlines(ticker: string, limit = 50): Promise<Headline[]> {
  // We store news in HDFS as JSON Lines under /data/bronze/crypto_news/YYYY-MM-DD/.
  // To keep this simple, we read from a single known partition (latest available
  // for today). If unavailable, we fall back to an empty list.
  const today = new Date().toISOString().slice(0, 10);
  const dates = [today, yesterday(today)];
  for (const d of dates) {
    const path = `/data/bronze/crypto_news/${d}/headlines.jsonl`;
    const url = new URL(`${HDFS_BASE}${path}`);
    url.searchParams.set("op", "OPEN");
    url.searchParams.set("offset", "0");
    url.searchParams.set("length", String(50 * 1024 * 1024));
    try {
      const r = await fetch(url.toString());
      if (!r.ok) continue;
      const text = await r.text();
      const lines = text.split("\n").filter(Boolean);
      const headlines: Headline[] = [];
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if ((obj.ticker ?? "").toUpperCase() !== ticker.toUpperCase()) continue;
          headlines.push({
            date: obj.date ?? d,
            ticker: obj.ticker,
            headline: obj.headline ?? "",
            source: obj.source ?? "",
          });
          if (headlines.length >= limit) break;
        } catch {
          // skip malformed lines
        }
      }
      if (headlines.length > 0) return headlines;
    } catch {
      // try next date
    }
  }
  return [];
}

function yesterday(dateStr: string): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Fetch daily returns for a set of tickers, used for cross-symbol charts. */
export async function getDailyReturns(tickers: string[], days = 90): Promise<{ ticker: string; date: string; return_pct: number }[]> {
  const client = new Client(PG);
  try {
    await client.connect();
    const placeholders = tickers.map((_, i) => `$${i + 1}`).join(",");
    const result = await client.query(
      `SELECT ticker, date::text, return_pct
       FROM gold.daily_returns
       WHERE ticker IN (${placeholders})
       ORDER BY date DESC
       LIMIT $${tickers.length + 1}`,
      [...tickers.map((t) => t.toUpperCase()), days * tickers.length]
    );
    return result.rows.map((r) => ({
      ticker: r.ticker,
      date: r.date,
      return_pct: parseFloat(r.return_pct),
    }));
  } catch (err) {
    console.error("getDailyReturns error:", err);
    return [];
  } finally {
    await client.end();
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
  const client = new Client(PG);
  try {
    await client.connect();
    const out: ComparisonMetrics[] = [];
    for (const t of tickers) {
      const r = await client.query(
        `SELECT
           AVG(return_pct) AS mean_return,
           STDDEV_SAMP(return_pct) AS volatility,
           (SELECT close FROM gold.daily_returns dr2
            WHERE dr2.ticker = $1 ORDER BY date DESC LIMIT 1) AS latest_close
         FROM gold.daily_returns WHERE ticker = $1`,
        [t.toUpperCase()]
      );
      const news = await client.query(
        `SELECT COALESCE(SUM(headline_count), 0)::int AS n FROM gold.news_volume_per_coin WHERE ticker = $1`,
        [t.toUpperCase()]
      );
      const row = r.rows[0];
      out.push({
        ticker: t.toUpperCase(),
        mean_return: row.mean_return != null ? parseFloat(row.mean_return) : null,
        volatility: row.volatility != null ? parseFloat(row.volatility) : null,
        total_news: news.rows[0]?.n ?? 0,
        latest_close: row.latest_close != null ? parseFloat(row.latest_close) : null,
      });
    }
    return out;
  } catch (err) {
    console.error("getComparisonMetrics error:", err);
    return [];
  } finally {
    await client.end();
  }
}

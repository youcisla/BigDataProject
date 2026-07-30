import type { NextApiRequest, NextApiResponse } from "next";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { startJob } from "../../lib/jobs";
import { pythonCmd } from "../../lib/exec";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const DUMPS_DIR = path.resolve(PROJECT_ROOT, "data", "dumps");
const ACTIVE_FILE = path.resolve(DUMPS_DIR, ".active");

const STOCKS_DIR = process.env.STOCKS_DIR ?? "data/Stocks";
const ETFS_DIR = process.env.ETFS_DIR ?? "data/ETFs";

/**
 * Optional ticker allow-list: one symbol per line.
 *
 * This used to resolve to the uploaded bulk *dataset* and hand it to
 * `--tickers-file`, which reads every line as a ticker symbol — so a
 * multi-GB OHLCV CSV was parsed as millions of bogus symbols and matched
 * nothing. Only accept a small, plausible ticker list here.
 */
const MAX_TICKER_FILE_BYTES = 64 * 1024;

async function resolveTickersFile(): Promise<string | null> {
  const candidates: string[] = [];

  if (process.env.TICKERS_FILE) candidates.push(process.env.TICKERS_FILE);

  try {
    const raw = (await fs.readFile(ACTIVE_FILE, "utf-8")).trim();
    if (raw) candidates.push(path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw));
  } catch {
    // no active dataset selected
  }

  for (const candidate of candidates) {
    if (!fsSync.existsSync(candidate)) continue;
    const stat = await fs.stat(candidate);
    if (stat.isFile() && stat.size <= MAX_TICKER_FILE_BYTES) return candidate;
  }
  return null;
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  if (!fsSync.existsSync(path.resolve(PROJECT_ROOT, STOCKS_DIR))) {
    res.status(400).json({
      error: `stocks directory not found: ${STOCKS_DIR}. Extract the Kaggle OHLCV archive there, or set STOCKS_DIR.`,
    });
    return;
  }

  const args = ["scripts/fetch_stocks.py", "--folder", STOCKS_DIR, "--folder", ETFS_DIR];
  const tickersFile = await resolveTickersFile();
  if (tickersFile) args.push("--tickers-file", tickersFile);

  const job = startJob(pythonCmd(), args, "bulk");
  res.status(202).json({
    jobId: job.id,
    status: job.status,
    startedAt: job.startedAt,
    folders: [STOCKS_DIR, ETFS_DIR],
    tickersFile,
  });
}

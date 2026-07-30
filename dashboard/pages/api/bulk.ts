import type { NextApiRequest, NextApiResponse } from "next";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { startJob } from "../../lib/jobs";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const DUMPS_DIR = path.resolve(PROJECT_ROOT, "data", "dumps");
const ACTIVE_FILE = path.resolve(DUMPS_DIR, ".active");

async function resolveBulkPath(): Promise<string> {
  // 1. env var wins
  const envPath = process.env.REDDIT_BULK_PATH;
  if (envPath && fsSync.existsSync(envPath)) return envPath;

  // 2. active dataset file (set by dashboard upload or select)
  try {
    const raw = (await fs.readFile(ACTIVE_FILE, "utf-8")).trim();
    if (raw) {
      const full = path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
      if (fsSync.existsSync(full)) return full;
    }
  } catch {
    // ignore
  }

  // 3. most recently uploaded CSV in data/dumps/
  try {
    const entries = await fs.readdir(DUMPS_DIR);
    const files = entries.filter((n) => !n.startsWith("."));
    if (files.length > 0) {
      files.sort();
      return path.join(DUMPS_DIR, files[files.length - 1]);
    }
  } catch {
    // ignore
  }

  // 4. fallback (legacy default)
  return "data/reddit_opinion_PSE_ISR.csv";
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const bulkPath = await resolveBulkPath();
  const job = startJob(
    process.platform === "win32" ? "python" : "python3",
    ["scripts/fetch_stocks.py", "--tickers-file", bulkPath],
    "bulk"
  );
  res.status(202).json({ jobId: job.id, status: job.status, startedAt: job.startedAt, bulkPath });
}

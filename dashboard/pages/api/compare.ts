import type { NextApiRequest, NextApiResponse } from "next";
import {
  computeCorrelationMatrix,
  getComparisonMetrics,
  getDailyReturns,
} from "../../lib/data-source";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const raw = String(req.query.tickers ?? "");
  const tickers = raw.split(",").map((t) => t.trim()).filter(Boolean);
  if (tickers.length < 2) {
    res.status(400).json({ error: "need at least 2 tickers (comma-separated)" });
    return;
  }

  try {
    const [returns, metrics] = await Promise.all([
      getDailyReturns(tickers, 90),
      getComparisonMetrics(tickers),
    ]);
    const correlation = computeCorrelationMatrix(returns);
    res.status(200).json({ tickers, returns, metrics, correlation });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

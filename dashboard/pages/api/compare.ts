import type { NextApiRequest, NextApiResponse } from "next";
import {
  computeCorrelationMatrix,
  getComparisonMetrics,
  getDailyReturns,
  getHeadlineTerms,
  getRecentPrices,
} from "../../lib/data-source";

const MAX_TICKERS = 6;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const raw = String(req.query.tickers ?? "");
  const tickers = Array.from(
    new Set(raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)),
  );

  if (tickers.length < 2) {
    res.status(400).json({ error: "need at least 2 tickers (comma-separated)" });
    return;
  }
  if (tickers.length > MAX_TICKERS) {
    res.status(400).json({ error: `at most ${MAX_TICKERS} tickers` });
    return;
  }

  try {
    const [returns, metrics, prices, words] = await Promise.all([
      getDailyReturns(tickers, 90),
      getComparisonMetrics(tickers),
      getRecentPrices(tickers, 90),
      getHeadlineTerms(tickers),
    ]);
    const correlation = computeCorrelationMatrix(returns);
    res.status(200).json({ tickers, returns, metrics, prices, words, correlation });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

import type { NextApiRequest, NextApiResponse } from "next";
import { getOhlcv, getHeadlines, getSentimentSeries, getAvailableIntervals } from "../../../lib/data-source";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ticker = String(req.query.ticker ?? "").toUpperCase();
  if (!ticker) {
    res.status(400).json({ error: "missing ticker" });
    return;
  }

  try {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    const [ohlcv, headlines, sentiment, intervals] = await Promise.all([
      // 20 years of daily bars, so the "All" timeframe has something to show.
      getOhlcv(ticker, 8000),
      getHeadlines(ticker, 200, { from, to }),
      getSentimentSeries(ticker, 2000),
      getAvailableIntervals(ticker),
    ]);
    res.status(200).json({ ticker, ohlcv, headlines, sentiment, intervals });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

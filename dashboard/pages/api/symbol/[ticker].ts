import type { NextApiRequest, NextApiResponse } from "next";
import { getOhlcv, getHeadlines } from "../../../lib/data-source";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ticker = String(req.query.ticker ?? "").toUpperCase();
  if (!ticker) {
    res.status(400).json({ error: "missing ticker" });
    return;
  }

  try {
    const [ohlcv, headlines] = await Promise.all([
      getOhlcv(ticker, 1000),
      getHeadlines(ticker, 50),
    ]);
    res.status(200).json({ ticker, ohlcv, headlines });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

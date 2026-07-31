import type { NextApiRequest, NextApiResponse } from "next";
import { getIntraday, INTRADAY_INTERVALS } from "../../lib/data-source";

/** Sub-daily bars for one ticker + interval. Served separately from the symbol
 *  payload so switching timeframe does not refetch news and sentiment too. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ticker = String(req.query.ticker ?? "").toUpperCase();
  const interval = String(req.query.interval ?? "");

  if (!ticker) {
    res.status(400).json({ error: "missing ticker" });
    return;
  }
  if (!(INTRADAY_INTERVALS as readonly string[]).includes(interval)) {
    res.status(400).json({ error: `interval must be one of ${INTRADAY_INTERVALS.join(", ")}` });
    return;
  }

  try {
    const bars = await getIntraday(ticker, interval);
    res.status(200).json({ ticker, interval, bars });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

import type { NextApiRequest, NextApiResponse } from "next";
import { listSymbols } from "../../lib/data-source";

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const symbols = await listSymbols();
    res.status(200).json({ symbols });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

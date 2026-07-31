import type { NextApiRequest, NextApiResponse } from "next";
import { getTablePage, isGoldTable } from "../../lib/data-source";

/** Paginated browser over a Gold table. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const name = String(req.query.name ?? "");
  if (!isGoldTable(name)) {
    res.status(400).json({ error: `unknown table: ${name}` });
    return;
  }

  const limit = Number(req.query.limit ?? 50);
  const offset = Number(req.query.offset ?? 0);
  const column = typeof req.query.column === "string" ? req.query.column : "";
  const value = typeof req.query.q === "string" ? req.query.q : "";

  try {
    const page = await getTablePage(
      name,
      limit,
      offset,
      column && value ? { column, value } : undefined,
    );
    res.status(200).json({ table: name, ...page });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

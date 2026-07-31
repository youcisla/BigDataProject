import type { NextApiRequest, NextApiResponse } from "next";
import { contentSummary, headLines, listDir, safeHdfsPath } from "../../lib/hdfs";

/**
 * Browse HDFS. `?path=` lists a directory (with a content summary);
 * `?path=<file>&preview=1` returns the first lines of a text file.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const path = safeHdfsPath(typeof req.query.path === "string" ? req.query.path : undefined);
  const wantsPreview = req.query.preview === "1";

  try {
    if (wantsPreview) {
      const lines = await headLines(path, Number(req.query.lines ?? 25));
      // Bronze is JSON Lines; hand back parsed objects when we can so the UI
      // can render a table instead of a wall of text.
      const parsed = lines.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { _raw: line };
        }
      });
      res.status(200).json({ path, lines: parsed, count: parsed.length });
      return;
    }

    const [entries, summary] = await Promise.all([listDir(path), contentSummary(path)]);
    res.status(200).json({ path, entries, summary });
  } catch (err) {
    res.status(502).json({ error: String(err), path });
  }
}

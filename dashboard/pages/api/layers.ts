import type { NextApiRequest, NextApiResponse } from "next";
import { contentSummary, listDir, type HdfsEntry } from "../../lib/hdfs";
import { getGoldStats, getWarehouseOverview } from "../../lib/data-source";

export interface BronzeSource {
  source: string;
  partitions: { date: string; files: number; bytes: number }[];
  bytes: number;
}

export interface LayersPayload {
  bronze: { sources: BronzeSource[]; bytes: number; error?: string };
  silver: {
    partitions: { sourceType: string; dates: string[]; files: number; bytes: number }[];
    bytes: number;
    error?: string;
  };
  gold: {
    tables: { name: string; label: string; description: string; rows: number }[];
    overview: Awaited<ReturnType<typeof getWarehouseOverview>>;
  };
  checkedAt: number;
}

// Walking HDFS costs several round trips; the layout only changes when the
// pipeline runs, so a short cache keeps the page snappy without going stale.
const CACHE_MS = 15_000;
let cached: LayersPayload | null = null;
let inFlight: Promise<LayersPayload> | null = null;

async function readBronze(): Promise<LayersPayload["bronze"]> {
  try {
    const sources = await listDir("/data/bronze");
    const out: BronzeSource[] = [];
    for (const src of sources.filter((s) => s.type === "DIRECTORY")) {
      const dates = await listDir(src.path);
      const partitions = await Promise.all(
        dates
          .filter((d) => d.type === "DIRECTORY")
          .map(async (d) => {
            const files = await listDir(d.path).catch(() => [] as HdfsEntry[]);
            return {
              date: d.name,
              files: files.length,
              bytes: files.reduce((sum, f) => sum + f.size, 0),
            };
          }),
      );
      partitions.sort((a, b) => b.date.localeCompare(a.date));
      out.push({
        source: src.name,
        partitions,
        bytes: partitions.reduce((sum, p) => sum + p.bytes, 0),
      });
    }
    out.sort((a, b) => b.bytes - a.bytes);
    return { sources: out, bytes: out.reduce((s, x) => s + x.bytes, 0) };
  } catch (err) {
    return { sources: [], bytes: 0, error: String(err) };
  }
}

async function readSilver(): Promise<LayersPayload["silver"]> {
  try {
    const summary = await contentSummary("/data/silver");
    const roots = await listDir("/data/silver/data").catch(() => [] as HdfsEntry[]);
    const partitions = await Promise.all(
      roots
        .filter((r) => r.type === "DIRECTORY" && r.name.startsWith("source_type="))
        .map(async (r) => {
          const dateDirs = await listDir(r.path).catch(() => [] as HdfsEntry[]);
          let files = 0;
          let bytes = 0;
          for (const d of dateDirs.filter((d) => d.type === "DIRECTORY")) {
            const parquet = await listDir(d.path).catch(() => [] as HdfsEntry[]);
            files += parquet.filter((p) => p.name.endsWith(".parquet")).length;
            bytes += parquet.reduce((sum, p) => sum + p.size, 0);
          }
          return {
            sourceType: r.name.replace("source_type=", ""),
            dates: dateDirs
              .filter((d) => d.type === "DIRECTORY")
              .map((d) => d.name.replace("partition_date=", "")),
            files,
            bytes,
          };
        }),
    );
    partitions.sort((a, b) => b.bytes - a.bytes);
    return { partitions, bytes: summary?.length ?? partitions.reduce((s, p) => s + p.bytes, 0) };
  } catch (err) {
    return { partitions: [], bytes: 0, error: String(err) };
  }
}

async function probe(): Promise<LayersPayload> {
  const [bronze, silver, tables, overview] = await Promise.all([
    readBronze(),
    readSilver(),
    getGoldStats(),
    getWarehouseOverview(),
  ]);
  return { bronze, silver, gold: { tables, overview }, checkedAt: Date.now() };
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse<LayersPayload>) {
  if (cached && Date.now() - cached.checkedAt < CACHE_MS) {
    res.status(200).json(cached);
    return;
  }
  if (!inFlight) {
    inFlight = probe()
      .then((r) => {
        cached = r;
        return r;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  res.status(200).json(await inFlight);
}

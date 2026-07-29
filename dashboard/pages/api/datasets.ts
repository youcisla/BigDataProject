import type { NextApiRequest, NextApiResponse } from "next";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const DUMPS_DIR = path.resolve(PROJECT_ROOT, "data", "dumps");
const ACTIVE_FILE = path.resolve(DUMPS_DIR, ".active");

interface DatasetInfo {
  name: string;
  path: string;
  sizeBytes: number;
  uploadedAt: string;
}

interface DatasetsPayload {
  datasets: DatasetInfo[];
  active: string | null;
  error?: string;
}

async function ensureDumpsDir(): Promise<void> {
  if (!fsSync.existsSync(DUMPS_DIR)) {
    await fs.mkdir(DUMPS_DIR, { recursive: true });
  }
}

async function listDatasets(): Promise<DatasetInfo[]> {
  await ensureDumpsDir();
  const entries = await fs.readdir(DUMPS_DIR);
  const datasets: DatasetInfo[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = path.join(DUMPS_DIR, name);
    const stat = await fs.stat(full);
    if (!stat.isFile()) continue;
    datasets.push({
      name,
      path: full,
      sizeBytes: stat.size,
      uploadedAt: stat.mtime.toISOString(),
    });
  }
  datasets.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return datasets;
}

async function getActive(): Promise<string | null> {
  try {
    const raw = await fs.readFile(ACTIVE_FILE, "utf-8");
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const fullPath = path.isAbsolute(trimmed) ? trimmed : path.resolve(PROJECT_ROOT, trimmed);
    if (fsSync.existsSync(fullPath)) return fullPath;
    return null;
  } catch {
    return null;
  }
}

async function setActive(filepath: string): Promise<void> {
  await ensureDumpsDir();
  await fs.writeFile(ACTIVE_FILE, filepath, "utf-8");
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10gb",
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<DatasetsPayload | { ok: boolean; saved?: string; error?: string }>) {
  await ensureDumpsDir();

  if (req.method === "GET") {
    const [datasets, active] = await Promise.all([listDatasets(), getActive()]);
    return res.status(200).json({ datasets, active });
  }

  if (req.method === "POST") {
    try {
      const contentType = req.headers["content-type"] ?? "";

      // Multipart upload (browser form)
      if (contentType.includes("multipart/form-data")) {
        const form = await new Promise<{ fields: Record<string, string>; file?: { name: string; data: Buffer } }>(
          (resolve, reject) => {
            const fields: Record<string, string> = {};
            let fileData: Buffer | null = null;
            let fileName = "";

            const busboy = require("busboy");
            const bb = busboy({ headers: req.headers });
            bb.on("field", (name: string, val: string) => {
              fields[name] = val;
            });
            bb.on("file", (_name: string, stream: NodeJS.ReadableStream, info: { filename: string }) => {
              fileName = info.filename;
              const chunks: Buffer[] = [];
              stream.on("data", (c: Buffer) => chunks.push(c));
              stream.on("end", () => {
                fileData = Buffer.concat(chunks);
              });
            });
            bb.on("close", () => {
              if (fileData && fileName) {
                resolve({ fields, file: { name: fileName, data: fileData as Buffer } });
              } else {
                reject(new Error("no file in upload"));
              }
            });
            bb.on("error", reject);
            req.pipe(bb);
          }
        );

        if (!form.file) {
          return res.status(400).json({ ok: false, error: "no file" });
        }
        const safeName = form.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        const finalName = `${stamp}_${safeName}`;
        const target = path.join(DUMPS_DIR, finalName);
        await fs.writeFile(target, form.file.data);
        await setActive(target);
        return res.status(200).json({ ok: true, saved: target });
      }

      // JSON path select
      const body = req.body as { action?: string; name?: string };
      if (body.action === "select" && typeof body.name === "string") {
        const candidate = path.join(DUMPS_DIR, body.name);
        if (!fsSync.existsSync(candidate)) {
          return res.status(404).json({ ok: false, error: "dataset not found" });
        }
        await setActive(candidate);
        return res.status(200).json({ ok: true, saved: candidate });
      }

      if (body.action === "delete" && typeof body.name === "string") {
        const candidate = path.join(DUMPS_DIR, body.name);
        if (!fsSync.existsSync(candidate)) {
          return res.status(404).json({ ok: false, error: "dataset not found" });
        }
        await fs.unlink(candidate);
        // If deleted file was active, clear active
        const active = await getActive();
        if (active === candidate) {
          try {
            await fs.unlink(ACTIVE_FILE);
          } catch {
            // ignore
          }
        }
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ ok: false, error: "unknown action" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err) });
    }
  }

  return res.status(405).json({ ok: false, error: "method not allowed" });
}

/**
 * HDFS access for the dashboard.
 *
 * Metadata operations (LISTSTATUS, GETCONTENTSUMMARY) work over WebHDFS from
 * the host: they are answered by the namenode directly.
 *
 * Reading file *content* does not. The namenode answers OPEN with a redirect to
 * the datanode's container hostname on port 9864, which does not resolve from
 * the host. So content preview goes through the namenode container instead.
 */

import { runExecAsync, dockerCmd } from "./exec";

const HDFS_HOST = process.env.HDFS_WEBHDFS_HOST ?? process.env.HDFS_NAMENODE ?? "localhost";
const HDFS_PORT = process.env.HDFS_WEB_UI_PORT ?? "9870";
const WEBHDFS = `http://${HDFS_HOST}:${HDFS_PORT}/webhdfs/v1`;

const WEBHDFS_TIMEOUT_MS = 8_000;

export interface HdfsEntry {
  name: string;
  path: string;
  type: "FILE" | "DIRECTORY";
  size: number;
  modified: number;
  owner: string;
  permission: string;
  childrenNum: number;
}

export interface HdfsSummary {
  length: number;
  fileCount: number;
  directoryCount: number;
  spaceConsumed: number;
}

async function webhdfs(path: string, op: string): Promise<any> {
  const url = `${WEBHDFS}${path}?op=${op}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHDFS_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`WebHDFS ${op} ${path} -> ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Normalise a caller-supplied path and keep it inside /data. */
export function safeHdfsPath(raw: string | undefined): string {
  const candidate = (raw ?? "/data").trim() || "/data";
  // Reject traversal outright rather than trying to normalise it away.
  if (candidate.includes("..") || !candidate.startsWith("/data")) return "/data";
  return candidate.replace(/\/+$/, "") || "/data";
}

export async function listDir(path: string): Promise<HdfsEntry[]> {
  const body = await webhdfs(path, "LISTSTATUS");
  const entries = body?.FileStatuses?.FileStatus ?? [];
  return entries
    .map((f: any) => ({
      name: f.pathSuffix,
      path: `${path === "/" ? "" : path}/${f.pathSuffix}`,
      type: f.type as "FILE" | "DIRECTORY",
      size: Number(f.length ?? 0),
      modified: Number(f.modificationTime ?? 0),
      owner: f.owner ?? "",
      permission: f.permission ?? "",
      childrenNum: Number(f.childrenNum ?? 0),
    }))
    .sort((a: HdfsEntry, b: HdfsEntry) => {
      if (a.type !== b.type) return a.type === "DIRECTORY" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function contentSummary(path: string): Promise<HdfsSummary | null> {
  try {
    const body = await webhdfs(path, "GETCONTENTSUMMARY");
    const s = body?.ContentSummary ?? {};
    return {
      length: Number(s.length ?? 0),
      fileCount: Number(s.fileCount ?? 0),
      directoryCount: Number(s.directoryCount ?? 0),
      spaceConsumed: Number(s.spaceConsumed ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * First N lines of an HDFS text file, read through the namenode container.
 *
 * `hdfs dfs -cat | head` rather than `-head`, because `-head` is capped at
 * 1 KB — far less than a single JSONL record here.
 */
export async function headLines(path: string, lines = 25): Promise<string[]> {
  const safeLines = Math.max(1, Math.min(500, Math.floor(lines)));
  const result = await runExecAsync(
    dockerCmd(),
    [
      "compose",
      "exec",
      "-T",
      "namenode",
      "sh",
      "-c",
      // The pipe closes early, so hdfs dfs exits 141 (SIGPIPE); swallow it.
      `hdfs dfs -cat '${path}' 2>/dev/null | head -n ${safeLines} || true`,
    ],
    20_000,
  );
  if (!result.stdout) return [];
  return result.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

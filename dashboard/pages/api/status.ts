import type { NextApiRequest, NextApiResponse } from "next";
import { runExecAsync } from "../../lib/exec";

interface ServiceStatus {
  name: string;
  status: string;
}

interface StatusPayload {
  services: ServiceStatus[];
  hdfs: { bronze: string; silver: string; gold: string; error?: string };
  postgres: { ready: boolean; error?: string };
  checkedAt: number;
}

const DOCKER = process.platform === "win32" ? "docker.exe" : "docker";

/**
 * Shelling out to docker costs seconds per call. Cache the result and share one
 * in-flight probe between concurrent requests, so N open tabs cost the same as
 * one and a fast re-poll is free.
 *
 * These calls used to run through execFileSync, which blocked Node's event loop
 * for the whole probe — freezing every other request, including page loads.
 */
const CACHE_MS = 10_000;
let cached: StatusPayload | null = null;
let inFlight: Promise<StatusPayload> | null = null;

async function probe(): Promise<StatusPayload> {
  const [compose, hdfsCheck, pgCheck] = await Promise.all([
    runExecAsync(DOCKER, ["compose", "ps", "--format", "json"], 10_000),
    runExecAsync(
      DOCKER,
      [
        "compose",
        "exec",
        "-T",
        "namenode",
        "hdfs",
        "dfs",
        "-du",
        "-h",
        "/data/bronze",
        "/data/silver",
        "/data/gold",
      ],
      15_000,
    ),
    runExecAsync(DOCKER, ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "gold"], 5_000),
  ]);

  let services: ServiceStatus[] = [];
  if (compose.ok) {
    services = compose.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          const obj = JSON.parse(line) as { Service?: string; Name?: string; State?: string };
          return { name: obj.Service ?? obj.Name ?? "?", status: obj.State ?? "unknown" };
        } catch {
          return { name: "?", status: "parse-error" };
        }
      });
  }

  const hdfs = {
    bronze: "",
    silver: "",
    gold: "",
    error: hdfsCheck.ok ? undefined : hdfsCheck.stderr.slice(0, 200),
  };
  if (hdfsCheck.ok) {
    for (const line of hdfsCheck.stdout.trim().split("\n")) {
      if (line.includes("/data/bronze")) hdfs.bronze = line.trim().split(/\s+/)[0];
      if (line.includes("/data/silver")) hdfs.silver = line.trim().split(/\s+/)[0];
      if (line.includes("/data/gold")) hdfs.gold = line.trim().split(/\s+/)[0];
    }
  }

  return {
    services,
    hdfs,
    postgres: { ready: pgCheck.ok, error: pgCheck.ok ? undefined : pgCheck.stderr.slice(0, 200) },
    checkedAt: Date.now(),
  };
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse<StatusPayload>) {
  if (cached && Date.now() - cached.checkedAt < CACHE_MS) {
    res.status(200).json(cached);
    return;
  }

  if (!inFlight) {
    inFlight = probe()
      .then((result) => {
        cached = result;
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  res.status(200).json(await inFlight);
}

import type { NextApiRequest, NextApiResponse } from "next";
import { runExec } from "../../lib/exec";

interface ServiceStatus {
  name: string;
  status: string;
}

interface StatusPayload {
  services: ServiceStatus[];
  hdfs: { bronze: string; silver: string; gold: string; error?: string };
  postgres: { ready: boolean; error?: string };
}

const DOCKER = process.platform === "win32" ? "docker.exe" : "docker";

export default function handler(_req: NextApiRequest, res: NextApiResponse<StatusPayload>) {
  const compose = runExec(DOCKER, ["compose", "ps", "--format", "json"], 10 * 1000);

  let services: ServiceStatus[] = [];
  if (compose.ok) {
    try {
      const lines = compose.stdout.trim().split("\n").filter(Boolean);
      services = lines.map((line) => {
        try {
          const obj = JSON.parse(line) as { Service?: string; Name?: string; State?: string };
          return { name: obj.Service ?? obj.Name ?? "?", status: obj.State ?? "unknown" };
        } catch {
          return { name: "?", status: "parse-error" };
        }
      });
    } catch {
      services = [];
    }
  }

  const hdfsCheck = runExec(
    DOCKER,
    [
      "compose",
      "exec",
      "-T",
      "-e",
      "HADOOP_CONF_DIR=/opt/hadoop/etc/hadoop",
      "namenode",
      "hdfs",
      "dfs",
      "-du",
      "-h",
      "/data/bronze",
      "/data/silver",
      "/data/gold",
    ],
    15 * 1000,
  );

  const hdfs = {
    bronze: "",
    silver: "",
    gold: "",
    error: hdfsCheck.ok ? undefined : hdfsCheck.stderr.slice(0, 200),
  };
  if (hdfsCheck.ok) {
    const lines = hdfsCheck.stdout.trim().split("\n");
    for (const line of lines) {
      if (line.includes("/data/bronze")) hdfs.bronze = line.trim().split(/\s+/)[0];
      if (line.includes("/data/silver")) hdfs.silver = line.trim().split(/\s+/)[0];
      if (line.includes("/data/gold")) hdfs.gold = line.trim().split(/\s+/)[0];
    }
  }

  const pgCheck = runExec(
    DOCKER,
    ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "gold"],
    5 * 1000,
  );

  res.status(200).json({
    services,
    hdfs,
    postgres: { ready: pgCheck.ok, error: pgCheck.ok ? undefined : pgCheck.stderr.slice(0, 200) },
  });
}

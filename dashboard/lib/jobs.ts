// Background job manager for pipeline commands.
//
// Each API route that runs a long command spawns a subprocess and tracks it in a
// shared in-memory registry. The frontend polls /api/progress?job=<id> to read
// stdout, stderr, status, and current record count.

import { spawn } from "node:child_process";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const LOG_DIR = path.resolve(PROJECT_ROOT, ".dashboard-logs");

export interface JobState {
  id: string;
  cmd: string;
  args: string[];
  status: "running" | "done" | "failed";
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
  records: number;
  lastId: string;
  progressStatus: string;
  stdoutTail: string;
  stderrTail: string;
  pid?: number;
}

const JOBS = new Map<string, JobState>();
const TAIL_BYTES = 16 * 1024;

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function startJob(cmd: string, args: string[], label?: string): JobState {
  const id = randomUUID();
  const job: JobState = {
    id,
    cmd,
    args,
    status: "running",
    startedAt: Date.now(),
    records: 0,
    lastId: "",
    progressStatus: "starting",
    stdoutTail: "",
    stderrTail: "",
  };
  JOBS.set(id, job);

  const stdoutLog = fs.openSync(path.join(LOG_DIR, `${id}.stdout.log`), "w");
  const stderrLog = fs.openSync(path.join(LOG_DIR, `${id}.stderr.log`), "w");

  const child = spawn(cmd, args, {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  job.pid = child.pid;

  const PROGRESS_RE = /PROGRESS\s+records=(\d+)\s+last_id=(\S*)\s+status=(\w+)/;

  child.stdout.on("data", (chunk: Buffer) => {
    fs.writeSync(stdoutLog, chunk);
    const text = chunk.toString();
    job.stdoutTail = (job.stdoutTail + text).slice(-TAIL_BYTES);

    for (const line of text.split(/\r?\n/)) {
      const m = PROGRESS_RE.exec(line);
      if (m) {
        job.records = parseInt(m[1], 10);
        job.lastId = m[2];
        job.progressStatus = m[3];
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    fs.writeSync(stderrLog, chunk);
    const text = chunk.toString();
    job.stderrTail = (job.stderrTail + text).slice(-TAIL_BYTES);

    for (const line of text.split(/\r?\n/)) {
      const m = PROGRESS_RE.exec(line);
      if (m) {
        job.records = parseInt(m[1], 10);
        job.lastId = m[2];
        job.progressStatus = m[3];
      }
    }
  });

  child.on("exit", (code) => {
    job.endedAt = Date.now();
    job.exitCode = code ?? -1;
    job.status = code === 0 ? "done" : "failed";
    job.progressStatus = code === 0 ? "final" : "failed";
    fs.closeSync(stdoutLog);
    fs.closeSync(stderrLog);
  });

  child.on("error", (err) => {
    job.stderrTail = (job.stderrTail + `\nspawn error: ${err.message}`).slice(-TAIL_BYTES);
    job.status = "failed";
    job.progressStatus = "failed";
    job.endedAt = Date.now();
  });

  return job;
}

export function getJob(id: string): JobState | undefined {
  return JOBS.get(id);
}

export function getActiveJobFor(label: string): JobState | undefined {
  for (const job of JOBS.values()) {
    if (job.cmd.includes(label) && job.status === "running") {
      return job;
    }
  }
  return undefined;
}

export function listJobs(): JobState[] {
  return Array.from(JOBS.values()).sort((a, b) => b.startedAt - a.startedAt).slice(0, 10);
}

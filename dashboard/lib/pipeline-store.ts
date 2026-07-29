import { useEffect } from "react";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

interface ServiceStatus {
  name: string;
  status: string;
}

interface StatusPayload {
  services: ServiceStatus[];
  hdfs: { bronze: string; silver: string; gold: string; error?: string };
  postgres: { ready: boolean; error?: string };
}

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
}

export type Cmd = "bulk" | "transform" | "load";

interface PipelineStore {
  status: StatusPayload | null;
  statusError: string | null;
  statusUpdatedAt: number | null;

  jobs: Record<Cmd, JobState | null>;
  jobsUpdatedAt: number | null;

  lastStatusFetch: number | null;
  lastJobsFetch: number | null;

  setStatus: (s: StatusPayload) => void;
  setStatusError: (msg: string) => void;
  setJobs: (jobs: JobState[]) => void;
  getJob: (cmd: Cmd) => JobState | null;
}

/** BroadcastChannel for syncing store state across browser tabs/windows. */
const CHANNEL = typeof window !== "undefined" ? new BroadcastChannel("bigdata-pipeline") : null;

function broadcastUpdate(key: "status" | "jobs", payload: unknown) {
  if (!CHANNEL) return;
  try {
    CHANNEL.postMessage({ key, payload, ts: Date.now() });
  } catch {
    // ignore
  }
}

export const usePipelineStore = create<PipelineStore>()(
  subscribeWithSelector((set, get) => ({
    status: null,
    statusError: null,
    statusUpdatedAt: null,
    jobs: { bulk: null, transform: null, load: null },
    jobsUpdatedAt: null,
    lastStatusFetch: null,
    lastJobsFetch: null,

    setStatus: (s) => {
      set({ status: s, statusUpdatedAt: Date.now(), lastStatusFetch: Date.now(), statusError: null });
      broadcastUpdate("status", s);
    },

    setStatusError: (msg) =>
      set({ statusError: msg, statusUpdatedAt: Date.now(), lastStatusFetch: Date.now() }),

    setJobs: (jobsList) => {
      const next: Record<Cmd, JobState | null> = { bulk: null, transform: null, load: null };
      for (const j of jobsList) {
        if (j.args.some((a) => a.includes("fetch_reddit"))) next.bulk = j;
        else if (j.args.some((a) => a.includes("silver_transform"))) next.transform = j;
        else if (j.args.some((a) => a.includes("gold_kpis"))) next.load = j;
      }
      set({ jobs: next, jobsUpdatedAt: Date.now(), lastJobsFetch: Date.now() });
      broadcastUpdate("jobs", jobsList);
    },

    getJob: (cmd) => get().jobs[cmd],
  }))
);

// Cross-tab sync: when one tab updates, all tabs receive.
if (CHANNEL) {
  CHANNEL.onmessage = (ev) => {
    const { key, payload, ts } = ev.data ?? {};
    if (!key || !payload) return;
    if (key === "status") {
      usePipelineStore.setState({
        status: payload,
        statusUpdatedAt: ts ?? Date.now(),
      });
    } else if (key === "jobs") {
      const next: Record<Cmd, JobState | null> = { bulk: null, transform: null, load: null };
      for (const j of payload as JobState[]) {
        if (j.args.some((a) => a.includes("fetch_reddit"))) next.bulk = j;
        else if (j.args.some((a) => a.includes("silver_transform"))) next.transform = j;
        else if (j.args.some((a) => a.includes("gold_kpis"))) next.load = j;
      }
      usePipelineStore.setState({ jobs: next, jobsUpdatedAt: ts ?? Date.now() });
    }
  };
}

/**
 * Background sync hook: polls APIs and pushes into store. Mount once at app root.
 * The store itself is the single source of truth shared by every section AND every tab.
 */
export function usePipelineSync() {
  const setStatus = usePipelineStore((s) => s.setStatus);
  const setStatusError = usePipelineStore((s) => s.setStatusError);
  const setJobs = usePipelineStore((s) => s.setJobs);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const r = await fetch("/api/status");
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j = (await r.json()) as StatusPayload;
        if (!cancelled) setStatus(j);
      } catch (err) {
        if (!cancelled) setStatusError(String(err));
      }
    };

    const fetchJobs = async () => {
      try {
        const r = await fetch("/api/progress");
        if (!r.ok) return;
        const j = (await r.json()) as { jobs: JobState[] };
        if (!cancelled) setJobs(j.jobs);
      } catch {
        // silent
      }
    };

    fetchStatus();
    fetchJobs();
    const statusInterval = setInterval(fetchStatus, 5000);
    const jobsInterval = setInterval(fetchJobs, 1500);

    return () => {
      cancelled = true;
      clearInterval(statusInterval);
      clearInterval(jobsInterval);
    };
  }, [setStatus, setStatusError, setJobs]);
}

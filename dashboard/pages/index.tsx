"use client";

import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { AnimatePresence, motion, LayoutGroup } from "framer-motion";
import { toast } from "sonner";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Check,
  ChevronRight,
  Database,
  ExternalLink,
  Eye,
  GitBranch,
  Layers,
  Loader2,
  PlayCircle,
  RefreshCcw,
  Settings as SettingsIcon,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ThemeToggle } from "@/components/theme-toggle";
import { PulseDot } from "@/components/pulse-dot";
import { KpiCard } from "@/components/kpi-card";
import { RunningBanner } from "@/components/running-banner";
import { DatasetsPanel } from "@/components/datasets-panel";
import { fadeInUp, stagger, slideInRight } from "@/lib/animations";
import { useMetricHistory, parseHdfsSize } from "@/lib/metrics-history";
import { usePipelineStore, type Cmd, type JobState } from "@/lib/pipeline-store";
import { formatRelative, formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";

const PIPELINE_BUTTONS: { id: Cmd; label: string; description: string; href: string }[] = [
  { id: "bulk", label: "1. Bulk", description: "Stocks + Crypto archives to HDFS Bronze", href: "#bulk" },
  { id: "transform", label: "2. Transform", description: "Bronze to Silver Parquet", href: "#transform" },
  { id: "load", label: "3. Load", description: "Silver to Postgres KPIs", href: "#load" },
];

const NAV = [
  { id: "overview", label: "Overview", icon: Sparkles, href: "#overview" },
  { id: "pipeline", label: "Pipeline", icon: GitBranch, href: "#pipeline" },
  { id: "analysis", label: "Analysis", icon: Eye, href: "/analysis" },
  { id: "logs", label: "Logs", icon: TerminalSquare, href: "#logs" },
  { id: "settings", label: "Settings", icon: SettingsIcon, href: "#settings" },
];

export default function Home() {
  const status = usePipelineStore((s) => s.status);
  const statusError = usePipelineStore((s) => s.statusError);
  const statusUpdatedAt = usePipelineStore((s) => s.statusUpdatedAt);
  const jobs = usePipelineStore((s) => s.jobs);
  const jobsUpdatedAt = usePipelineStore((s) => s.jobsUpdatedAt);
  const setStatus = usePipelineStore((s) => s.setStatus);
  const setJobs = usePipelineStore((s) => s.setJobs);

  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [activeSection, setActiveSection] = useState<"overview" | "pipeline" | "logs" | "settings">("overview");

  // Hash-based section sync (works without router)
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace("#", "");
      if (h === "overview" || h === "pipeline" || h === "logs" || h === "settings") {
        setActiveSection(h);
      } else if (h === "bulk" || h === "transform" || h === "load") {
        setActiveSection("pipeline");
        setTimeout(() => {
          document.getElementById(h)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Live "X seconds ago" tick
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const navigate = (id: typeof activeSection) => {
    setActiveSection(id);
    window.location.hash = id;
  };

  const bronzeHistory = useMetricHistory("bronze", parseHdfsSize(status?.hdfs.bronze ?? ""));
  const silverHistory = useMetricHistory("silver", parseHdfsSize(status?.hdfs.silver ?? ""));
  const goldHistory = useMetricHistory("gold", parseHdfsSize(status?.hdfs.gold ?? ""));
  const healthyCount = status
    ? status.services.filter((s) => s.status.toLowerCase().includes("running") || s.status.toLowerCase().includes("healthy")).length
    : 0;
  const totalCount = status?.services.length ?? 0;
  const healthyHistory = useMetricHistory("healthy", totalCount > 0 ? (healthyCount / totalCount) * 100 : 0);

  const start = async (cmd: Cmd) => {
    const label = cmd === "bulk" ? "Bulk" : cmd === "transform" ? "Transform" : "Load";
    const toastId = toast.loading(`Starting ${label}...`, { description: "Spawning background job." });
    try {
      const r = await fetch(`/api/${cmd}`, { method: "POST" });
      const j = (await r.json()) as { jobId: string };
      toast.success(`${label} job started`, {
        id: toastId,
        description: `Job ID: ${j.jobId.slice(0, 8)} - watch the live progress.`,
      });
    } catch (err) {
      toast.error(`Failed to start ${label}`, { id: toastId, description: String(err) });
    }
  };

  const refresh = async () => {
    const t = toast.loading("Refreshing...");
    try {
      const r = await fetch("/api/status");
      const j = await r.json();
      setStatus(j);
      toast.success("Refreshed", { id: t });
    } catch (err) {
      toast.error("Refresh failed", { id: t, description: String(err) });
    }
  };

  const activeJob = PIPELINE_BUTTONS.map((b) => b.id).map((c) => jobs[c]).find((j) => j?.status === "running");

  const runningBanner = useMemo(() => {
    if (!activeJob || bannerDismissed) return null;
    return {
      label: jobCmdLabel(activeJob.cmd, activeJob.args),
      startedAt: activeJob.startedAt,
      records: activeJob.records,
      lastId: activeJob.lastId,
    };
  }, [activeJob, bannerDismissed]);

  useEffect(() => {
    if (activeJob && bannerDismissed) setBannerDismissed(false);
  }, [activeJob?.id]);

  const serviceTone = (text: string) =>
    text.toLowerCase().includes("running") || text.toLowerCase().includes("healthy") ? "success" : "neutral";

  const hdfsUsage = useMemo(() => {
    if (!status) return { bronze: "0", silver: "0", gold: "0" };
    return {
      bronze: status.hdfs.bronze || "0",
      silver: status.hdfs.silver || "0",
      gold: status.hdfs.gold || "0",
    };
  }, [status]);

  const recentRuns = PIPELINE_BUTTONS
    .map((b) => jobs[b.id])
    .filter((j): j is JobState => j !== null && j.status !== "running")
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, 5);

  return (
    <>
      <Head>
        <title>BigData Pipeline</title>
      </Head>
      <main className="min-h-screen bg-background text-foreground">
        <div className="grid min-h-screen grid-cols-[260px_1fr]">
          {/* Sidebar */}
          <aside className="border-r bg-card/30 backdrop-blur-sm flex flex-col sticky top-0 h-screen">
            <div className="p-6 border-b">
              <div className="flex items-center gap-3">
                <motion.div
                  initial={{ rotate: -10, scale: 0.9 }}
                  animate={{ rotate: 0, scale: 1 }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/30"
                >
                  <Database className="h-5 w-5 text-white" />
                </motion.div>
                <div>
                  <h1 className="text-base font-semibold leading-tight">BigData Pipeline</h1>
                  <p className="text-xs text-muted-foreground">Medallion dashboard</p>
                </div>
              </div>
            </div>

            <nav className="flex-1 p-3 space-y-1">
              {NAV.map((item) => (
                <button
                  key={item.id}
                  onClick={() => navigate(item.id as typeof activeSection)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all relative group",
                    activeSection === item.id
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                  {activeSection === item.id && (
                    <motion.span
                      layoutId="nav-indicator"
                      className="absolute right-2 h-1.5 w-1.5 rounded-full bg-current"
                    />
                  )}
                </button>
              ))}
            </nav>

            <div className="p-3 border-t space-y-1">
              <Button variant="ghost" size="sm" asChild className="w-full justify-start">
                <a href="http://localhost:3000" target="_blank" rel="noreferrer">
                  <Activity className="h-4 w-4" />
                  Grafana
                  <ExternalLink className="ml-auto h-3 w-3 opacity-50" />
                </a>
              </Button>
              <Button variant="ghost" size="sm" asChild className="w-full justify-start">
                <a href="http://localhost:9090" target="_blank" rel="noreferrer">
                  <Activity className="h-4 w-4" />
                  Prometheus
                  <ExternalLink className="ml-auto h-3 w-3 opacity-50" />
                </a>
              </Button>
              <div className="text-[10px] text-muted-foreground/60 mt-3 px-1 font-mono">
                {jobsUpdatedAt && <div>jobs: {formatRelative(jobsUpdatedAt)}</div>}
                {statusUpdatedAt && <div>status: {formatRelative(statusUpdatedAt)}</div>}
              </div>
            </div>
          </aside>

          {/* Main */}
          <div className="overflow-auto">
            <RunningBanner job={runningBanner} onDismiss={() => setBannerDismissed(true)} />

            <motion.header
              initial="hidden"
              animate="visible"
              variants={fadeInUp}
              className="sticky top-0 z-10 backdrop-blur-md bg-background/80 border-b px-8 py-4 flex items-center justify-between"
            >
              <div>
                <h2 className="text-2xl font-bold tracking-tight capitalize">{activeSection}</h2>
                <p className="text-sm text-muted-foreground">
                  {activeSection === "overview" && "Live pipeline health and storage"}
                  {activeSection === "pipeline" && "Trigger and monitor Bronze, Silver, Gold stages"}
                  {activeSection === "logs" && "Live stdout from running jobs"}
                  {activeSection === "settings" && "Theme and connection status"}
                  <span className="ml-2 opacity-60">
                    - {statusUpdatedAt ? `updated ${formatRelative(statusUpdatedAt)}` : "loading..."}
                  </span>
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={refresh} title="Refresh">
                  <RefreshCcw className="h-4 w-4" />
                  Refresh
                </Button>
                <ThemeToggle />
              </div>
            </motion.header>

            <LayoutGroup>
              <motion.div
                initial="hidden"
                animate="visible"
                variants={stagger}
                className="p-8 space-y-6 max-w-6xl"
              >
                <AnimatePresence mode="wait">
                  {activeSection === "overview" && (
                    <motion.div
                      key="overview"
                      variants={stagger}
                      initial="hidden"
                      animate="visible"
                      exit={{ opacity: 0, y: -10 }}
                      className="space-y-6"
                    >
                      {/* Live sync banner */}
                      <motion.div
                        variants={fadeInUp}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <PulseDot tone={statusError ? "danger" : status ? "success" : "neutral"} />
                        <span>
                          {statusError
                            ? `Status fetch error: ${statusError}`
                            : status
                            ? `Live - synced across tabs via BroadcastChannel`
                            : "Connecting to backend..."}
                        </span>
                        {jobsUpdatedAt && <span className="opacity-50">- jobs: {formatRelative(jobsUpdatedAt)}</span>}
                      </motion.div>

                      {/* KPI cards */}
                      <motion.div variants={fadeInUp} className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <KpiCard label="Bronze records" value={hdfsUsage.bronze} history={bronzeHistory} />
                        <KpiCard label="Silver records" value={hdfsUsage.silver} history={silverHistory} />
                        <KpiCard label="Gold records" value={hdfsUsage.gold} history={goldHistory} />
                        <KpiCard
                          label="Cluster health"
                          value={status ? `${healthyCount}/${totalCount}` : "-"}
                          history={healthyHistory.map((v) => (v / 100) * (totalCount || 1))}
                          trend={healthyHistory.length >= 2 ? (healthyHistory[healthyHistory.length - 1] >= healthyHistory[healthyHistory.length - 2] ? "up" : "down") : "flat"}
                        />
                      </motion.div>

                      {/* Services grid */}
                      <motion.div variants={fadeInUp}>
                        <Card className="bg-card/40 backdrop-blur-sm">
                          <CardHeader>
                            <div className="flex items-center justify-between">
                              <CardTitle>Services</CardTitle>
                              <Button variant="ghost" size="sm" onClick={() => navigate("pipeline")}>
                                View pipeline
                                <ChevronRight className="h-3 w-3 ml-1" />
                              </Button>
                            </div>
                            <CardDescription>Container state from docker compose.</CardDescription>
                          </CardHeader>
                          <CardContent>
                            {status ? (
                              <LayoutGroup>
                                <motion.div layout className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                                  {status.services.map((s) => (
                                    <motion.div
                                      key={s.name}
                                      layout
                                      whileHover={{ y: -2 }}
                                      transition={{ duration: 0.15 }}
                                      className="flex items-center justify-between rounded-md border bg-background/40 px-3 py-2"
                                    >
                                      <span className="text-xs font-mono truncate">{s.name}</span>
                                      <PulseDot tone={serviceTone(s.status) as "success" | "neutral"} />
                                    </motion.div>
                                  ))}
                                </motion.div>
                              </LayoutGroup>
                            ) : (
                              <SkeletonGrid count={10} />
                            )}
                          </CardContent>
                        </Card>
                      </motion.div>

                      {/* Postgres + HDFS row */}
                      <motion.div variants={fadeInUp} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Card className="bg-card/40 backdrop-blur-sm">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Postgres</CardTitle>
                          </CardHeader>
                          <CardContent>
                            {status ? (
                              <div className="flex items-center gap-3">
                                <PulseDot tone={status.postgres.ready ? "success" : "danger"} />
                                <span className="text-lg font-semibold">{status.postgres.ready ? "Ready" : "Not ready"}</span>
                              </div>
                            ) : (
                              <SkeletonLine />
                            )}
                          </CardContent>
                        </Card>
                        <Card className="bg-card/40 backdrop-blur-sm">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-medium text-muted-foreground">HDFS total</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="text-lg font-mono">
                              {hdfsUsage.bronze} + {hdfsUsage.silver} + {hdfsUsage.gold}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">bronze + silver + gold</p>
                          </CardContent>
                        </Card>
                      </motion.div>

                      {/* Recent runs */}
                      {recentRuns.length > 0 && (
                        <motion.div variants={fadeInUp}>
                          <Card className="bg-card/40 backdrop-blur-sm">
                            <CardHeader className="pb-3">
                              <CardTitle className="text-base flex items-center gap-2">
                                <Eye className="h-4 w-4" /> Recent runs
                              </CardTitle>
                              <CardDescription>Last 5 pipeline runs, newest first.</CardDescription>
                            </CardHeader>
                            <CardContent>
                              <ul className="space-y-1.5">
                                {recentRuns.map((j) => (
                                  <motion.li
                                    key={j.id}
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="flex items-center gap-3 text-sm border-b last:border-b-0 pb-1.5 last:pb-0"
                                  >
                                    <Badge variant={j.status === "failed" ? "destructive" : "success"} className="w-16 justify-center">
                                      {j.status}
                                    </Badge>
                                    <span className="font-medium">{jobCmdLabel(j.cmd, j.args)}</span>
                                    <span className="text-xs text-muted-foreground font-mono">{j.records.toLocaleString()} rows</span>
                                    <span className="text-xs text-muted-foreground ml-auto">{j.endedAt ? formatRelative(j.endedAt) : ""}</span>
                                  </motion.li>
                                ))}
                              </ul>
                            </CardContent>
                          </Card>
                        </motion.div>
                      )}

                      {/* Empty state */}
                      {status && totalCount === 0 && (
                        <motion.div variants={fadeInUp}>
                          <Card className="bg-card/40 backdrop-blur-sm border-dashed">
                            <CardContent className="py-12 text-center space-y-2">
                              <Database className="h-10 w-10 text-muted-foreground mx-auto opacity-40" />
                              <div className="font-medium">No services running</div>
                              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                                The stack is not up. Run <code className="px-1.5 py-0.5 rounded bg-muted">docker compose up -d</code> from the project root.
                              </p>
                            </CardContent>
                          </Card>
                        </motion.div>
                      )}
                    </motion.div>
                  )}

                  {activeSection === "pipeline" && (
                    <motion.div
                      key="pipeline"
                      variants={stagger}
                      initial="hidden"
                      animate="visible"
                      exit={{ opacity: 0, y: -10 }}
                      className="space-y-6"
                    >
                      <motion.div variants={fadeInUp}>
                        <Card className="bg-card/40 backdrop-blur-sm">
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <PlayCircle className="h-5 w-5" /> Pipeline actions
                            </CardTitle>
                            <CardDescription>
                              Click triggers a background job. State syncs across browser tabs in real time.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <LayoutGroup>
                              <div className="grid gap-3 sm:grid-cols-3">
                                {PIPELINE_BUTTONS.map((b) => {
                                  const job = jobs[b.id];
                                  const running = job?.status === "running";
                                  const done = job?.status === "done";
                                  const failed = job?.status === "failed";
                                  return (
                                    <motion.button
                                      key={b.id}
                                      id={b.id}
                                      layout
                                      whileHover={!running ? { y: -2 } : {}}
                                      whileTap={!running ? { scale: 0.98 } : {}}
                                      disabled={!!activeJob}
                                      onClick={() => start(b.id)}
                                      className={cn(
                                        "relative overflow-hidden rounded-lg border p-4 text-left transition-all",
                                        "bg-gradient-to-br from-card to-card/60 backdrop-blur-sm",
                                        running && "ring-2 ring-blue-500/50",
                                        done && "ring-1 ring-emerald-500/40",
                                        failed && "ring-1 ring-red-500/40",
                                        "disabled:opacity-50 disabled:cursor-not-allowed"
                                      )}
                                    >
                                      <div className="flex items-center gap-2">
                                        {running ? <Loader2 className="h-4 w-4 animate-spin text-blue-500" /> : <GitBranch className="h-4 w-4" />}
                                        <span className="font-semibold text-sm">{b.label}</span>
                                        {job && (
                                          <motion.div
                                                                    initial={{ scale: 0.8, opacity: 0 }}
                                                                    animate={{ scale: 1, opacity: 1 }}
                                                                    transition={{ duration: 0.2 }}
                                                                  >
                                            <Badge variant={failed ? "destructive" : done ? "success" : "secondary"} className="ml-auto text-xs">
                                              {job.status}
                                            </Badge>
                                          </motion.div>
                                        )}
                                      </div>
                                      <div className="text-xs text-muted-foreground mt-1">{b.description}</div>
                                      {running && job && job.records > 0 && (
                                        <motion.div
                                          initial={{ opacity: 0, height: 0 }}
                                          animate={{ opacity: 1, height: "auto" }}
                                          className="mt-3 space-y-1 overflow-hidden"
                                        >
                                          <Progress value={job.records} max={Math.max(job.records * 1.2, 1000)} className="h-1" />
                                          <div className="text-xs text-muted-foreground font-mono flex justify-between">
                                            <span>{job.records.toLocaleString()} records</span>
                                            <span>last_id: {job.lastId || "-"}</span>
                                          </div>
                                        </motion.div>
                                      )}
                                    </motion.button>
                                  );
                                })}
                              </div>
                            </LayoutGroup>
                          </CardContent>
                        </Card>
                      </motion.div>

                      {/* Job timeline */}
                      <motion.div variants={fadeInUp}>
                        <Card className="bg-card/40 backdrop-blur-sm">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Layers className="h-4 w-4" /> Pipeline flow
                            </CardTitle>
                            <CardDescription>Visual order from raw data to KPIs.</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center gap-3 flex-wrap">
                              {["Stocks + Crypto CSVs", "HDFS Bronze", "Spark Silver", "Postgres Gold"].map((stage, i) => (
                                <div key={stage} className="flex items-center gap-3">
                                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border bg-background/40">
                                    {jobs[Object.keys(jobs)[i] as Cmd]?.status === "done" ? (
                                      <Check className="h-3 w-3 text-emerald-500" />
                                    ) : jobs[Object.keys(jobs)[i] as Cmd]?.status === "running" ? (
                                      <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                                    ) : (
                                      <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                                    )}
                                    <span className="text-sm">{stage}</span>
                                  </div>
                                  {i < 3 && <ArrowRight className="h-3 w-3 text-muted-foreground/40" />}
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>

                      {/* Last result per stage */}
                      {PIPELINE_BUTTONS.map((b) => {
                        const job = jobs[b.id];
                        if (!job || job.status === "running") return null;
                        return (
                          <motion.div key={b.id} variants={slideInRight} initial="hidden" animate="visible">
                            <Card className="bg-card/40 backdrop-blur-sm">
                              <CardHeader className="pb-3">
                                <CardTitle className="text-sm flex items-center justify-between">
                                  <span>Last {b.label.toLowerCase()}</span>
                                  <Badge variant={job.status === "failed" ? "destructive" : "success"}>
                                    {job.status} - exit {job.exitCode} - {job.records.toLocaleString()} rows
                                  </Badge>
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                {job.stderrTail && (
                                  <details>
                                    <summary className="text-xs cursor-pointer text-muted-foreground">stderr</summary>
                                    <pre className="mt-2 rounded bg-background/60 p-2 text-xs overflow-x-auto whitespace-pre-wrap font-mono max-h-40">
                                      {job.stderrTail}
                                    </pre>
                                  </details>
                                )}
                              </CardContent>
                            </Card>
                          </motion.div>
                        );
                      })}

                      {/* Dataset management */}
                      <motion.div variants={fadeInUp}>
                        <DatasetsPanel />
                      </motion.div>
                    </motion.div>
                  )}

                  {activeSection === "logs" && (
                    <motion.div key="logs" variants={fadeInUp} initial="hidden" animate="visible" exit={{ opacity: 0 }}>
                      <Card className="bg-card/40 backdrop-blur-sm">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <TerminalSquare className="h-5 w-5" /> Live logs
                          </CardTitle>
                          <CardDescription>Last stdout from the most recent job. Synced across tabs.</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <pre className="rounded bg-background/60 p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-[60vh] overflow-y-auto">
                            {activeJob?.stdoutTail ||
                              recentRuns[0]?.stdoutTail ||
                              "No log output yet. Run a pipeline action to see stdout here."}
                          </pre>
                        </CardContent>
                      </Card>
                    </motion.div>
                  )}

                  {activeSection === "settings" && (
                    <motion.div key="settings" variants={fadeInUp} initial="hidden" animate="visible" exit={{ opacity: 0 }}>
                      <Card className="bg-card/40 backdrop-blur-sm">
                        <CardHeader>
                          <CardTitle>Settings</CardTitle>
                          <CardDescription>Theme + connection info.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium">Theme</div>
                              <div className="text-xs text-muted-foreground">Light, dark, or follow system.</div>
                            </div>
                            <ThemeToggle />
                          </div>
                          <div className="border-t pt-4">
                            <div className="font-medium mb-1">Connections</div>
                            <div className="text-xs text-muted-foreground space-y-1 font-mono">
                              <div>HDFS: namenode:9000</div>
                              <div>Postgres: postgres:5432</div>
                              <div>Prometheus: prometheus:9090</div>
                              <div>Grafana: grafana:3000</div>
                            </div>
                          </div>
                          <div className="border-t pt-4">
                            <div className="font-medium mb-1">Sync</div>
                            <div className="text-xs text-muted-foreground space-y-1">
                              <div>State shared via zustand single store</div>
                              <div>Cross-tab sync via BroadcastChannel</div>
                              <div>Polling: status every 5s, jobs every 1.5s</div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </LayoutGroup>
          </div>
        </div>
      </main>
    </>
  );
}

function jobCmdLabel(cmd: string, args: string[]): string {
  if (args.some((a) => a.includes("fetch_stocks") || a.includes("fetch_crypto") || a.includes("fetch_news") || a.includes("fetch_reddit"))) return "Bulk";
  if (args.some((a) => a.includes("silver_transform"))) return "Transform";
  if (args.some((a) => a.includes("gold_kpis"))) return "Load";
  return `${cmd} ${args.slice(0, 2).join(" ")}`;
}

function SkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-9 rounded-md bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%]"
          style={{ animation: "shimmer 1.6s linear infinite" }}
        />
      ))}
    </div>
  );
}

function SkeletonLine() {
  return (
    <div
      className="h-6 w-32 rounded bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%]"
      style={{ animation: "shimmer 1.6s linear infinite" }}
    />
  );
}

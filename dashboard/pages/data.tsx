"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { motion } from "framer-motion";
import { Loader2, RefreshCcw } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { HdfsBrowser } from "@/components/hdfs-browser";
import { GoldTableBrowser } from "@/components/gold-table-browser";
import { MedallionFlow, SourceMix, type LayerStat } from "@/components/medallion-flow";
import { fadeInUp, stagger } from "@/lib/animations";
import { cn } from "@/lib/utils";

interface LayersPayload {
  bronze: {
    sources: { source: string; partitions: { date: string; files: number; bytes: number }[]; bytes: number }[];
    bytes: number;
    error?: string;
  };
  silver: {
    partitions: { sourceType: string; dates: string[]; files: number; bytes: number }[];
    bytes: number;
    error?: string;
  };
  gold: {
    tables: { name: string; label: string; description: string; rows: number }[];
    overview: {
      tickers: number;
      tradingDays: number;
      firstDate: string | null;
      lastDate: string | null;
      sources: { source: string; rows: number; tickers: number }[];
    };
  };
}

type Tab = "bronze" | "silver" | "gold" | "hdfs";

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "bronze", label: "Bronze", hint: "Raw ingested records, exactly as landed" },
  { id: "silver", label: "Silver", hint: "Cleaned, deduplicated, typed" },
  { id: "gold", label: "Gold", hint: "Aggregated KPIs in PostgreSQL" },
  { id: "hdfs", label: "HDFS", hint: "Browse the data lake filesystem" },
];

/** Bronze partitions hold one JSONL file whose name depends on the source. */
const BRONZE_FILE: Record<string, string> = {
  crypto_news: "headlines.jsonl",
  news_rss: "headlines.jsonl",
  crypto_live: "ohlc.jsonl",
  intraday: "bars.jsonl",
};

function bronzeFilename(source: string): string {
  return BRONZE_FILE[source] ?? "ohlcv.jsonl";
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function DataExplorer() {
  const [layers, setLayers] = useState<LayersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("bronze");

  // Bronze preview state
  const [bronzeFile, setBronzeFile] = useState<string | null>(null);
  const [bronzeRows, setBronzeRows] = useState<Record<string, unknown>[]>([]);
  const [bronzeLoading, setBronzeLoading] = useState(false);

  // Silver sample state
  const [silverType, setSilverType] = useState<string>("");
  const [silverRows, setSilverRows] = useState<Record<string, unknown>[]>([]);
  const [silverColumns, setSilverColumns] = useState<string[]>([]);
  const [silverLoading, setSilverLoading] = useState(false);

  const loadLayers = useCallback(() => {
    setLoading(true);
    fetch("/api/layers")
      .then((r) => r.json())
      .then(setLayers)
      .catch(() => setLayers(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => loadLayers(), [loadLayers]);

  // Auto-open the first Bronze partition so the tab is never empty on arrival.
  useEffect(() => {
    if (tab !== "bronze" || bronzeFile || !layers) return;
    const first = layers.bronze.sources[0];
    const part = first?.partitions[0];
    if (!first || !part) return;
    openBronze(`/data/bronze/${first.source}/${part.date}/${bronzeFilename(first.source)}`);
  }, [tab, layers, bronzeFile]);

  const openBronze = (path: string) => {
    setBronzeFile(path);
    setBronzeLoading(true);
    fetch(`/api/hdfs?path=${encodeURIComponent(path)}&preview=1&lines=40`)
      .then((r) => r.json())
      .then((j) => setBronzeRows(j.lines ?? []))
      .catch(() => setBronzeRows([]))
      .finally(() => setBronzeLoading(false));
  };

  const loadSilver = useCallback((sourceType: string) => {
    setSilverLoading(true);
    const params = new URLSearchParams({ name: "silver_sample", limit: "200", offset: "0" });
    fetch(`/api/table?${params}`)
      .then((r) => r.json())
      .then((j) => {
        const all: Record<string, unknown>[] = j.rows ?? [];
        setSilverColumns(j.columns ?? []);
        setSilverRows(sourceType ? all.filter((r) => r.source_type === sourceType) : all);
      })
      .catch(() => setSilverRows([]))
      .finally(() => setSilverLoading(false));
  }, []);

  useEffect(() => {
    if (tab === "silver") loadSilver(silverType);
  }, [tab, silverType, loadSilver]);

  const layerStats: LayerStat[] = useMemo(() => {
    const bronzeRecords = layers?.bronze.sources.reduce((s, x) => s + x.partitions.length, 0) ?? 0;
    const silverFiles = layers?.silver.partitions.reduce((s, p) => s + p.files, 0) ?? 0;
    const goldRows = layers?.gold.tables.reduce((s, t) => s + t.rows, 0) ?? 0;
    return [
      {
        id: "bronze",
        label: "Bronze",
        subtitle: "Raw · HDFS JSON Lines",
        bytes: layers?.bronze.bytes ?? 0,
        primary: layers?.bronze.sources.length ?? 0,
        primaryLabel: "sources",
        detail: [
          `${bronzeRecords} date partitions`,
          ...(layers?.bronze.sources.slice(0, 4).map((s) => `${s.source} · ${formatBytes(s.bytes)}`) ?? []),
        ],
      },
      {
        id: "silver",
        label: "Silver",
        subtitle: "Clean · HDFS Parquet",
        bytes: layers?.silver.bytes ?? 0,
        primary: silverFiles,
        primaryLabel: "parquet files",
        detail:
          layers?.silver.partitions.map((p) => `${p.sourceType} · ${p.files} files`) ?? [],
      },
      {
        id: "gold",
        label: "Gold",
        subtitle: "KPIs · PostgreSQL",
        bytes: 0,
        primary: goldRows,
        primaryLabel: "rows",
        detail: layers?.gold.tables.slice(0, 4).map((t) => `${t.name} · ${t.rows.toLocaleString()}`) ?? [],
      },
    ];
  }, [layers]);

  const bronzeColumns = bronzeRows.length
    ? Array.from(new Set(bronzeRows.flatMap((r) => Object.keys(r))))
    : [];

  const silverTypes = layers?.silver.partitions.map((p) => p.sourceType) ?? [];
  const overview = layers?.gold.overview;

  return (
    <>
      <Head>
        <title>Data explorer — BigData Pipeline</title>
      </Head>
      <AppShell
        active="data"
        title="Data explorer"
        subtitle="Every record the pipeline touches, from raw ingest to warehouse."
        actions={
          <Button variant="outline" size="sm" onClick={loadLayers} disabled={loading}>
            <RefreshCcw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        }
      >
        <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-6">
          {/* Medallion funnel */}
          <motion.section variants={fadeInUp} aria-label="Medallion layers">
            <MedallionFlow
              layers={layerStats}
              active={tab}
              onSelect={(id) => setTab(id)}
            />
          </motion.section>

          {/* Bento: coverage tiles, source mix, and a Bronze source rail */}
          <motion.section variants={fadeInUp} className="grid gap-4 lg:grid-cols-6">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Coverage</CardTitle>
                <CardDescription>What the warehouse holds.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <Stat label="Tickers" value={overview?.tickers.toLocaleString() ?? "—"} />
                <Stat label="Trading days" value={overview?.tradingDays.toLocaleString() ?? "—"} />
                <Stat label="From" value={overview?.firstDate ?? "—"} mono />
                <Stat label="To" value={overview?.lastDate ?? "—"} mono />
              </CardContent>
            </Card>

            <Card className="lg:col-span-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Rows by source</CardTitle>
                <CardDescription>Which ingested source each Gold price row came from.</CardDescription>
              </CardHeader>
              <CardContent>
                <SourceMix sources={overview?.sources ?? []} />
              </CardContent>
            </Card>
          </motion.section>

          {/* Layer tabs */}
          <motion.section variants={fadeInUp}>
            <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Data layers">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "rounded-md border px-4 py-2 text-sm font-medium transition-all",
                    tab === t.id
                      ? "border-primary bg-primary text-primary-foreground shadow"
                      : "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
              <p className="flex items-center text-xs text-muted-foreground">
                {TABS.find((t) => t.id === tab)?.hint}
              </p>
            </div>

            <Card>
              <CardContent className="pt-6">
                {tab === "bronze" && (
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {(layers?.bronze.sources ?? []).map((s) => (
                        <div key={s.source} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-sm font-medium">{s.source}</span>
                            <Badge variant="secondary" className="font-mono text-[10px]">
                              {formatBytes(s.bytes)}
                            </Badge>
                          </div>
                          <div className="mt-2 space-y-1">
                            {s.partitions.slice(0, 3).map((p) => {
                              const path = `/data/bronze/${s.source}/${p.date}/${bronzeFilename(s.source)}`;
                              return (
                                <button
                                  key={p.date}
                                  onClick={() => openBronze(path)}
                                  className={cn(
                                    "flex w-full items-center justify-between rounded px-2 py-1 text-left font-mono text-[11px] transition-colors",
                                    bronzeFile === path
                                      ? "bg-primary/10 text-primary"
                                      : "text-muted-foreground hover:bg-accent",
                                  )}
                                >
                                  <span>{p.date}</span>
                                  <span className="tabular-nums">{formatBytes(p.bytes)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>

                    {layers?.bronze.error && (
                      <p className="text-sm text-destructive">{layers.bronze.error}</p>
                    )}

                    <div>
                      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{bronzeFile ?? "select a partition"}</span>
                        {bronzeRows.length > 0 && <span>— first {bronzeRows.length} records</span>}
                      </div>
                      {bronzeLoading ? (
                        <Loading label="Reading from HDFS…" />
                      ) : (
                        <DataTable
                          columns={bronzeColumns}
                          rows={bronzeRows}
                          emptyMessage="Pick a partition above to preview its raw records."
                        />
                      )}
                    </div>
                  </div>
                )}

                {tab === "silver" && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setSilverType("")}
                        aria-pressed={silverType === ""}
                        className={cn(
                          "rounded-md border px-3 py-1.5 text-xs transition-all",
                          silverType === "" ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                        )}
                      >
                        All types
                      </button>
                      {silverTypes.map((t) => {
                        const p = layers?.silver.partitions.find((x) => x.sourceType === t);
                        return (
                          <button
                            key={t}
                            onClick={() => setSilverType(t)}
                            aria-pressed={silverType === t}
                            className={cn(
                              "rounded-md border px-3 py-1.5 text-xs transition-all",
                              silverType === t ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                            )}
                          >
                            <span className="font-mono">{t}</span>
                            <span className="ml-2 opacity-70">{p ? formatBytes(p.bytes) : ""}</span>
                          </button>
                        );
                      })}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Silver lives as Parquet on HDFS. This is a materialised sample published to
                      <code className="mx-1 font-mono">gold.silver_sample</code> by the Gold job — the
                      dashboard speaks SQL, not Parquet. Partition layout is in the HDFS tab.
                    </p>

                    {silverLoading ? (
                      <Loading label="Loading Silver sample…" />
                    ) : (
                      <DataTable
                        columns={silverColumns}
                        rows={silverRows}
                        emptyMessage="No Silver sample yet — run make load."
                        maxHeight={520}
                      />
                    )}
                  </div>
                )}

                {tab === "gold" && <GoldTableBrowser tables={layers?.gold.tables ?? []} />}

                {tab === "hdfs" && <HdfsBrowser root="/data" />}
              </CardContent>
            </Card>
          </motion.section>
        </motion.div>
      </AppShell>
    </>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border bg-card/40 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-bold", mono ? "font-mono text-base" : "tabular-nums")}>{value}</div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

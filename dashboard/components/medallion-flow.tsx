"use client";

import { motion } from "framer-motion";
import { ArrowRight, Database, HardDrive, Layers, Table2 } from "lucide-react";

import { cn } from "@/lib/utils";

export interface LayerStat {
  id: "bronze" | "silver" | "gold";
  label: string;
  subtitle: string;
  bytes: number;
  primary: number;
  primaryLabel: string;
  detail: string[];
  running?: boolean;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const TONE = {
  bronze: {
    ring: "ring-amber-500/30",
    bar: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    glow: "shadow-amber-500/20",
    icon: HardDrive,
  },
  silver: {
    ring: "ring-slate-400/30",
    bar: "bg-slate-400",
    text: "text-slate-600 dark:text-slate-300",
    glow: "shadow-slate-400/20",
    icon: Layers,
  },
  gold: {
    ring: "ring-yellow-500/30",
    bar: "bg-yellow-500",
    text: "text-yellow-600 dark:text-yellow-400",
    glow: "shadow-yellow-500/20",
    icon: Table2,
  },
} as const;

/**
 * The Medallion architecture rendered with the actual numbers flowing through
 * it, rather than a static diagram. Each card is a filter: clicking it opens
 * that layer's records below.
 */
export function MedallionFlow({ layers, onSelect, active }: {
  layers: LayerStat[];
  onSelect?: (id: LayerStat["id"]) => void;
  active?: string;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
      {layers.map((layer, i) => {
        const tone = TONE[layer.id];
        const Icon = tone.icon;
        const isActive = active === layer.id;

        return (
          <div key={layer.id} className="contents">
            <motion.button
              type="button"
              onClick={() => onSelect?.(layer.id)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.35, ease: "easeOut" }}
              className={cn(
                "group relative overflow-hidden rounded-xl border bg-card p-4 text-left transition-all",
                "hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive && `ring-2 ${tone.ring} shadow-lg ${tone.glow}`,
              )}
              aria-pressed={isActive}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Icon className={cn("h-4 w-4", tone.text)} />
                  <div>
                    <div className="text-sm font-semibold leading-tight">{layer.label}</div>
                    <div className="text-[11px] text-muted-foreground">{layer.subtitle}</div>
                  </div>
                </div>
                {layer.running && (
                  <span className="flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-label="running" />
                )}
              </div>

              <div className="mt-3 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold tabular-nums">
                  {layer.primary.toLocaleString()}
                </span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {layer.primaryLabel}
                </span>
              </div>

              {/* A cross-layer bar would compare sources to files to rows —
                  different units. Use a fixed accent rule instead of implying
                  a proportion that does not exist. */}
              <motion.div
                className={cn("mt-2 h-1 rounded-full", tone.bar)}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                style={{ originX: 0 }}
                transition={{ delay: 0.2 + i * 0.08, duration: 0.5, ease: "easeOut" }}
              />

              <div className="mt-3 space-y-0.5">
                {layer.detail.map((d) => (
                  <div key={d} className="font-mono text-[11px] text-muted-foreground">
                    {d}
                  </div>
                ))}
              </div>

              {/* Gold lives in Postgres, so an HDFS byte count would be a lie. */}
              {layer.bytes > 0 && (
                <div className="mt-2 font-mono text-[11px] text-muted-foreground">
                  {formatBytes(layer.bytes)} on HDFS
                </div>
              )}
            </motion.button>

            {i < layers.length - 1 && (
              <div className="hidden items-center justify-center lg:flex" aria-hidden="true">
                <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Compact source-mix bar: which ingested source contributes what share. */
export function SourceMix({ sources }: { sources: { source: string; rows: number; tickers: number }[] }) {
  const total = sources.reduce((s, x) => s + x.rows, 0) || 1;
  const palette = [
    "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-violet-500",
    "bg-rose-500", "bg-cyan-500", "bg-lime-500", "bg-orange-500",
  ];

  if (sources.length === 0) {
    return <p className="text-sm text-muted-foreground">No sources loaded yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label="Row share by source">
        {sources.map((s, i) => (
          <motion.div
            key={s.source}
            className={palette[i % palette.length]}
            initial={{ width: 0 }}
            animate={{ width: `${(s.rows / total) * 100}%` }}
            transition={{ duration: 0.5, delay: i * 0.05 }}
            title={`${s.source}: ${s.rows.toLocaleString()} rows`}
          />
        ))}
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {sources.map((s, i) => (
          <div key={s.source} className="flex items-center gap-2 text-xs">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", palette[i % palette.length])} />
            <span className="truncate font-mono" title={s.source}>{s.source}</span>
            <span className="ml-auto shrink-0 font-mono tabular-nums text-muted-foreground">
              {s.rows.toLocaleString()} · {s.tickers} tk
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

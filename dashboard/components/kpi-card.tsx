"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkline } from "@/components/sparkline";

interface Props {
  label: string;
  value: string;
  history?: number[];
  trend?: "up" | "down" | "flat";
}

export function KpiCard({ label, value, history = [], trend }: Props) {
  const numeric = parseFloat(value.replace(/[^0-9.]/g, "")) || 0;
  const suffix = value.replace(/[0-9.]/g, "").trim();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const start = display;
    const end = numeric;
    if (start === end) return;
    const duration = 700;
    const steps = 30;
    const stepTime = duration / steps;
    let current = 0;
    const id = setInterval(() => {
      current += 1;
      const progress = current / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (end - start) * eased);
      if (current >= steps) clearInterval(id);
    }, stepTime);
    return () => clearInterval(id);
  }, [numeric]);

  const displayValue = numeric === 0 ? value : `${Math.round(display).toLocaleString()}${suffix ? " " + suffix : ""}`;

  const trendColor = trend === "up" ? "text-emerald-500" : trend === "down" ? "text-red-500" : "text-slate-400";

  const trendDir = history.length >= 2 ? (history[history.length - 1] > history[history.length - 2] ? "up" : history[history.length - 1] < history[history.length - 2] ? "down" : "flat") : trend;
  const sparklineColor =
    trendDir === "up" ? "rgb(16 185 129)" : trendDir === "down" ? "rgb(239 68 68)" : "rgb(100 116 139)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-lg border bg-card/40 backdrop-blur-sm p-4 space-y-2"
    >
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
        <div className={trendDir === "up" ? "text-emerald-500" : trendDir === "down" ? "text-red-500" : "text-slate-400"}>
          {trendDir === "up" ? "↑" : trendDir === "down" ? "↓" : trendDir === "flat" ? "→" : ""}
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xl font-bold font-mono">{displayValue}</span>
      </div>
      {history.length > 1 && (
        <Sparkline values={history} width={200} height={28} stroke={sparklineColor} fill={sparklineColor} />
      )}
      {history.length <= 1 && (
        <div className="h-7 flex items-center text-xs text-muted-foreground opacity-50">awaiting samples...</div>
      )}
    </motion.div>
  );
}

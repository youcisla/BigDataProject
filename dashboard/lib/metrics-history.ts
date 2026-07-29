"use client";

import { useEffect, useRef, useState } from "react";

const MAX_SAMPLES = 60;

export type MetricKey = "bronze" | "silver" | "gold" | "healthy";

export function useMetricHistory(key: MetricKey, currentValue: number) {
  const [history, setHistory] = useState<Record<MetricKey, number[]>>({
    bronze: [],
    silver: [],
    gold: [],
    healthy: [],
  });
  const lastSeen = useRef<Record<MetricKey, number>>({
    bronze: -1,
    silver: -1,
    gold: -1,
    healthy: -1,
  });

  useEffect(() => {
    if (lastSeen.current[key] === currentValue) return;
    lastSeen.current[key] = currentValue;
    setHistory((prev) => {
      const next = [...prev[key], currentValue];
      const trimmed = next.length > MAX_SAMPLES ? next.slice(-MAX_SAMPLES) : next;
      return { ...prev, [key]: trimmed };
    });
  }, [key, currentValue]);

  return history[key];
}

export function parseHdfsSize(value: string): number {
  if (!value || value === "-") return 0;
  const match = value.match(/^([\d.]+)\s*([KMGT]?)$/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2];
  const mult = unit === "K" ? 1e3 : unit === "M" ? 1e6 : unit === "G" ? 1e9 : unit === "T" ? 1e12 : 1;
  return num * mult;
}

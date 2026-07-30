"use client";

import { useMemo } from "react";

interface Props {
  /** Each ticker has a value per metric. Values are normalized 0..1 per metric. */
  data: { ticker: string; values: Record<string, number> }[];
  metrics: string[]; // axis labels
  size?: number;
}

const PALETTE = ["#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#fb7185"];

/**
 * Radar / spider chart: per-ticker polygon across metrics.
 * Values must be normalized 0..1 (caller's responsibility).
 */
export function RadarChart({ data, metrics, size = 360 }: Props) {
  const radius = size / 2 - 30;
  const cx = size / 2;
  const cy = size / 2;
  const angleFor = (i: number) => (i / metrics.length) * 2 * Math.PI - Math.PI / 2;

  if (data.length === 0 || metrics.length === 0) {
    return (
      <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
        No data.
      </div>
    );
  }

  const gridRadii = [0.25, 0.5, 0.75, 1];

  return (
    <svg width={size} height={size} className="font-mono">
      <g transform={`translate(${cx},${cy})`}>
        {/* Grid */}
        {gridRadii.map((r) => (
          <circle key={r} r={radius * r} fill="none" stroke="#334155" strokeDasharray="2,2" />
        ))}
        {/* Axes + labels */}
        {metrics.map((m, i) => {
          const angle = angleFor(i);
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          return (
            <g key={m}>
              <line x1={0} y1={0} x2={x} y2={y} stroke="#334155" />
              <text
                x={Math.cos(angle) * (radius + 14)}
                y={Math.sin(angle) * (radius + 14)}
                fontSize="10"
                fill="#94a3b8"
                textAnchor={x > 0 ? "start" : x < 0 ? "end" : "middle"}
                dominantBaseline="middle"
              >
                {m}
              </text>
            </g>
          );
        })}
        {/* Ticker polygons */}
        {data.map((d, idx) => {
          const color = PALETTE[idx % PALETTE.length];
          const points = metrics
            .map((m, i) => {
              const v = Math.max(0, Math.min(1, d.values[m] ?? 0));
              const angle = angleFor(i);
              return [Math.cos(angle) * radius * v, Math.sin(angle) * radius * v];
            })
            .map((p) => p.join(","))
            .join(" ");
          return (
            <g key={d.ticker}>
              <polygon points={points} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={1.5} />
              {metrics.map((m, i) => {
                const v = Math.max(0, Math.min(1, d.values[m] ?? 0));
                const angle = angleFor(i);
                return (
                  <circle
                    key={`${d.ticker}-${m}`}
                    cx={Math.cos(angle) * radius * v}
                    cy={Math.sin(angle) * radius * v}
                    r={3}
                    fill={color}
                  />
                );
              })}
            </g>
          );
        })}
      </g>
      {/* Legend */}
      <g transform={`translate(${size - 70},20)`}>
        {data.map((d, idx) => (
          <g key={d.ticker} transform={`translate(0,${idx * 16})`}>
            <rect width="10" height="10" fill={PALETTE[idx % PALETTE.length]} />
            <text x="14" y="9" fontSize="10" fill="#cbd5e1">
              {d.ticker}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

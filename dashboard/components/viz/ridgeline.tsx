// @ts-nocheck
"use client";

import { useMemo } from "react";
import { extent, scaleLinear, mean, deviation } from "d3-array";

interface Props {
  /** One entry per ticker; each entry's `values` is an array of daily returns in %. */
  data: { ticker: string; values: number[] }[];
  width?: number;
  height?: number;
}

const PALETTE = ["#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#fb7185"];

/**
 * Ridgeline plot: stacked density curves per ticker. Pure SVG, no deps.
 * Uses a Gaussian kernel-density estimate per ticker; small bandwidth for
 * compact display across many tickers.
 */
export function RidgelineChart({ data, width = 700, height = 360 }: Props) {
  const rows = useMemo(() => {
    if (data.length === 0) return [];
    const all = data.flatMap((d) => d.values);
    const [lo, hi] = extent(all) as [number, number];
    if (lo === undefined) return [];
    const span = hi - lo || 1;
    const grid = 60;
    const step = span / grid;
    const x = scaleLinear().domain([lo, hi]).range([40, width - 20]);

    const bw = Math.max(span / 12, 0.5); // Silverman-ish bandwidth
    const peakH = height / (data.length + 1);
    const rows = data.map((d, i) => {
      const n = d.values.length;
      const meanV = mean(d.values) ?? 0;
      const sd = deviation(d.values) ?? 1;
      const y0 = 10 + i * (peakH + 4);
      const points: [number, number][] = [];
      for (let g = 0; g <= grid; g++) {
        const xv = lo + g * step;
        const z = (xv - meanV) / sd;
        const k = (1 / (sd * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * z * z);
        const density = k * n * bw;
        points.push([x(xv), y0 + (peakH - density * peakH * 4)]);
      }
      return { ticker: d.ticker, points, meanX: x(meanV), y0 };
    });
    return { rows, x, lo, hi };
  }, [data, width, height]);

  if (!rows || data.length === 0) {
    return (
      <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
        No data.
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r2: any = rows;

  return (
    <svg width={width} height={height} className="font-mono">
      {r2.rows.map((r: any, idx: number) => {
        const color = PALETTE[idx % PALETTE.length];
        const path = r.points.map((p: number[], i: number) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
        return (
          <g key={r.ticker}>
            <text x="2" y={r.y0 + 12} fontSize="10" fill="#cbd5e1">
              {r.ticker}
            </text>
            <path d={path} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1} />
            <line x1={r.meanX} x2={r.meanX} y1={r.y0} y2={r.y0 + 40} stroke={color} strokeOpacity={0.6} strokeDasharray="2,2" />
          </g>
        );
      })}
      <line x1={40} x2={width - 20} y1={height - 5} y2={height - 5} stroke="#475569" />
      {[r2.lo, (r2.lo + r2.hi) / 2, r2.hi].map((t: number, i: number) => (
        <g key={i} transform={`translate(${r2.x(t)},${height - 1})`}>
          <text fontSize="10" fill="#94a3b8" textAnchor="middle">
            {t.toFixed(1)}%
          </text>
        </g>
      ))}
    </svg>
  );
}

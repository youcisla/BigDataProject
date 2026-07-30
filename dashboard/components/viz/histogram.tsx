// @ts-nocheck
"use client";

import { useMemo } from "react";
import { bin, extent, max, min, scaleLinear } from "d3-array";

interface Datum {
  ticker: string;
  value: number;
}

interface Props {
  data: Datum[];
  width?: number;
  height?: number;
}

const PALETTE = ["#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#fb7185"];

export function HistogramChart({ data, width = 360, height = 220 }: Props) {
  const series = useMemo(() => {
    const grouped = new Map<string, number[]>();
    for (const d of data) {
      if (!grouped.has(d.ticker)) grouped.set(d.ticker, []);
      grouped.get(d.ticker)!.push(d.value);
    }
    return Array.from(grouped.entries());
  }, [data]);

  if (series.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        No data.
      </div>
    );
  }

  const allValues = series.flatMap(([, v]) => v);
  const [lo, hi] = extent(allValues) as [number, number];
  if (lo === hi) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        All values equal.
      </div>
    );
  }
  const bins = 20;
  const x = scaleLinear().domain([lo, hi]).range([0, width - 80]).nice();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const binGen: any = bin<Datum>().value((d: Datum) => d.value).domain([lo, hi]).thresholds(bins);

  const maxCount = max(series.flatMap(([t, v]) => binGen(v).map((b) => b.length))) ?? 1;
  const y = scaleLinear().domain([0, maxCount]).range([height - 30, 10]);

  return (
    <svg width={width} height={height} className="font-mono">
      <g transform="translate(60,0)">
        {series.map(([ticker, values], idx) => {
          const binned: any[] = binGen(values);
          const color = PALETTE[idx % PALETTE.length];
          return (
            <g key={ticker}>
              {binned.map((b: any) => {
                const x0 = x(b.x0 ?? 0);
                const x1 = x(b.x1 ?? 0);
                const y0 = y(b.length);
                return (
                  <rect
                    key={`${ticker}-${b.x0}-${b.x1}`}
                    x={x0}
                    y={y0}
                    width={Math.max(1, x1 - x0)}
                    height={height - 30 - y0}
                    fill={color}
                    opacity={0.5}
                  />
                );
              })}
            </g>
          );
        })}
        {x.ticks(6).map((t) => (
          <g key={t} transform={`translate(${x(t)},0)`}>
            <line y1={height - 30} y2={height - 25} stroke="#475569" />
            <text y={height - 12} fontSize="10" fill="#94a3b8" textAnchor="middle">
              {t.toFixed(1)}%
            </text>
          </g>
        ))}
        <line x1={0} x2={width - 80} y1={height - 30} y2={height - 30} stroke="#475569" />
      </g>
      <g>
        {series.map(([ticker], idx) => (
          <g key={ticker} transform={`translate(${width - 70},${20 + idx * 18})`}>
            <rect width="10" height="10" fill={PALETTE[idx % PALETTE.length]} opacity={0.5} />
            <text x="14" y="9" fontSize="10" fill="#cbd5e1">
              {ticker}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

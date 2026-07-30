// @ts-nocheck
"use client";

import { extent, scaleLinear } from "d3-array";

interface Props {
  data: { date: string; close: number; volume: number; return_pct: number; ticker: string }[];
  width?: number;
  height?: number;
}

const PALETTE = ["#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#fb7185"];

/**
 * Bubble map: x=date, y=close, size=volume, color=return_pct.
 * Classic financial scatter for comparing several tickers in one view.
 */
export function BubbleMap({ data, width = 760, height = 380 }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-[380px] items-center justify-center text-sm text-muted-foreground">
        No data.
      </div>
    );
  }

  const dates = data.map((d) => new Date(d.date).getTime());
  const closes = data.map((d) => d.close);
  const volumes = data.map((d) => d.volume || 1);

  const [minD, maxD] = extent(dates) as [number, number];
  const [minC, maxC] = extent(closes) as [number, number];
  const [minV, maxV] = extent(volumes) as [number, number];
  if (minD === undefined || minC === undefined || minV === undefined) {
    return null;
  }

  const x = scaleLinear().domain([minD, maxD]).range([50, width - 20]);
  const y = scaleLinear().domain([minC, maxC]).range([height - 30, 20]);
  const r = scaleLinear().domain([minV, maxV]).range([2, 18]);

  const tickers = Array.from(new Set(data.map((d) => d.ticker)));
  const colorFor = (ticker: string) => PALETTE[tickers.indexOf(ticker) % PALETTE.length];

  return (
    <svg width={width} height={height} className="font-mono">
      <line x1={50} x2={width - 10} y1={height - 25} y2={height - 25} stroke="#475569" />
      <line x1={50} x2={50} y1={10} y2={height - 25} stroke="#475569" />
      {y.ticks(6).map((t) => (
        <g key={t} transform={`translate(45,${y(t)})`}>
          <line x2={5} stroke="#475569" />
          <text x="-6" y="3" fontSize="10" fill="#94a3b8" textAnchor="end">
            {t.toFixed(0)}
          </text>
        </g>
      ))}
      {x.ticks(6).map((t) => {
        const d = new Date(t);
        return (
          <g key={t} transform={`translate(${x(t)},${height - 25})`}>
            <line y2={5} stroke="#475569" />
            <text y="14" fontSize="10" fill="#94a3b8" textAnchor="middle">
              {`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const t = new Date(d.date).getTime();
        const ret = d.return_pct;
        const fill = ret >= 0 ? "#10b981" : "#ef4444";
        return (
          <circle
            key={i}
            cx={x(t)}
            cy={y(d.close)}
            r={r(d.volume || 1)}
            fill={fill}
            fillOpacity={0.6}
            stroke={colorFor(d.ticker)}
            strokeWidth={1}
          />
        );
      })}
      {/* Legend */}
      <g transform={`translate(${width - 70},20)`}>
        {tickers.map((t, i) => (
          <g key={t} transform={`translate(0,${i * 16})`}>
            <circle cx="5" cy="5" r="5" fill={colorFor(t)} fillOpacity={0.6} />
            <text x="14" y="9" fontSize="10" fill="#cbd5e1">
              {t}
            </text>
          </g>
        ))}
        <g transform={`translate(0,${tickers.length * 16 + 8})`}>
          <circle cx="5" cy="5" r="5" fill="#10b981" fillOpacity={0.6} />
          <text x="14" y="9" fontSize="10" fill="#cbd5e1">
            gain
          </text>
        </g>
        <g transform={`translate(0,${tickers.length * 16 + 24})`}>
          <circle cx="5" cy="5" r="5" fill="#ef4444" fillOpacity={0.6} />
          <text x="14" y="9" fontSize="10" fill="#cbd5e1">
            loss
          </text>
        </g>
      </g>
    </svg>
  );
}

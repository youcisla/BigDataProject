"use client";

import { useMemo } from "react";
import { extent } from "d3-array";
import { scaleLinear } from "d3-scale";

export interface SentimentPoint {
  date: string;
  avg_sentiment: number | null;
  headline_count: number;
  return_pct: number | null;
}

/**
 * News tone against next-day return.
 *
 * Sentiment is compared to the *following* day's return, not the same day's:
 * a headline published during or after a move cannot have caused it, so
 * aligning them same-day would overstate any relationship. The printed
 * correlation is Pearson's r over the lagged pairs.
 */
export function SentimentImpact({
  data,
  width = 640,
  height = 300,
}: {
  data: SentimentPoint[];
  width?: number;
  height?: number;
}) {
  const model = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
    const pairs: { sentiment: number; nextReturn: number; count: number; date: string }[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const s = sorted[i].avg_sentiment;
      const r = sorted[i + 1].return_pct;
      if (s == null || r == null) continue;
      pairs.push({ sentiment: s, nextReturn: r, count: sorted[i].headline_count, date: sorted[i].date });
    }
    if (pairs.length < 3) return null;

    const xs = pairs.map((p) => p.sentiment);
    const ys = pairs.map((p) => p.nextReturn);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    const denom = Math.sqrt(dx * dy);
    const r = denom === 0 ? 0 : num / denom;
    const slope = dx === 0 ? 0 : num / dx;

    return { pairs, r, slope, mx, my };
  }, [data]);

  if (!model) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground"
        style={{ height }}
      >
        Not enough overlapping news and price days for this symbol.
      </div>
    );
  }

  const pad = { top: 16, right: 16, bottom: 36, left: 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const [sxLo, sxHi] = extent(model.pairs.map((p) => p.sentiment)) as [number, number];
  const [syLo, syHi] = extent(model.pairs.map((p) => p.nextReturn)) as [number, number];
  const xPad = Math.max(0.05, (sxHi - sxLo) * 0.1);
  const yPad = Math.max(0.5, (syHi - syLo) * 0.1);

  const x = scaleLinear().domain([sxLo - xPad, sxHi + xPad]).range([0, innerW]).nice();
  const y = scaleLinear().domain([syLo - yPad, syHi + yPad]).range([innerH, 0]).nice();
  const maxCount = Math.max(...model.pairs.map((p) => p.count), 1);
  const radius = scaleLinear().domain([1, maxCount]).range([3, 11]);

  const [x0, x1] = x.domain();
  const lineY0 = model.my + model.slope * (x0 - model.mx);
  const lineY1 = model.my + model.slope * (x1 - model.mx);

  const strength = Math.abs(model.r);
  const verdict =
    strength < 0.1 ? "no meaningful relationship" : strength < 0.3 ? "a weak relationship" : "a moderate relationship";

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="News sentiment versus next-day return">
        <g transform={`translate(${pad.left},${pad.top})`}>
          {y.ticks(5).map((t) => (
            <g key={`y${t}`} transform={`translate(0,${y(t)})`}>
              <line x2={innerW} className="stroke-border" strokeDasharray="2 3" />
              <text x={-8} dy="0.32em" textAnchor="end" className="fill-muted-foreground" fontSize="10">
                {t.toFixed(1)}%
              </text>
            </g>
          ))}
          {x.ticks(6).map((t) => (
            <g key={`x${t}`} transform={`translate(${x(t)},${innerH})`}>
              <line y2={5} className="stroke-border" />
              <text y={18} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
                {t.toFixed(2)}
              </text>
            </g>
          ))}

          {/* Zero lines: neutral tone, and a flat return. */}
          <line x1={x(0)} x2={x(0)} y1={0} y2={innerH} className="stroke-muted-foreground/40" strokeDasharray="4 3" />
          <line x1={0} x2={innerW} y1={y(0)} y2={y(0)} className="stroke-muted-foreground/40" strokeDasharray="4 3" />

          <line
            x1={x(x0)}
            y1={y(lineY0)}
            x2={x(x1)}
            y2={y(lineY1)}
            stroke="#6366f1"
            strokeWidth={2}
            strokeOpacity={0.85}
          />

          {model.pairs.map((p, i) => (
            <circle
              key={i}
              cx={x(p.sentiment)}
              cy={y(p.nextReturn)}
              r={radius(p.count)}
              fill={p.nextReturn >= 0 ? "#10b981" : "#ef4444"}
              fillOpacity={0.45}
              stroke={p.nextReturn >= 0 ? "#10b981" : "#ef4444"}
              strokeOpacity={0.8}
            >
              <title>{`${p.date}\nsentiment ${p.sentiment.toFixed(3)} · ${p.count} headlines\nnext-day return ${p.nextReturn.toFixed(2)}%`}</title>
            </circle>
          ))}

          <text x={innerW / 2} y={innerH + 32} textAnchor="middle" className="fill-muted-foreground" fontSize="11">
            average news sentiment (VADER compound)
          </text>
          <text
            transform={`translate(${-36},${innerH / 2}) rotate(-90)`}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize="11"
          >
            next-day return %
          </text>
        </g>
      </svg>

      <p className="text-xs text-muted-foreground">
        Pearson r = <span className="font-mono font-semibold text-foreground">{model.r.toFixed(3)}</span> over{" "}
        {model.pairs.length} days — {verdict} between today&rsquo;s news tone and tomorrow&rsquo;s move.
        Bubble size is the number of headlines that day. Correlation is not causation.
      </p>
    </div>
  );
}

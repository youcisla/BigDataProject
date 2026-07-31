"use client";

import { useMemo } from "react";
import { chord, ribbon } from "d3-chord";
import { arc } from "d3-shape";

interface Props {
  /** Symmetric correlation matrix. matrix[i][j] in [-1, 1]. */
  matrix: number[][];
  tickers: string[];
  size?: number;
}

const COLOR_PALETTE = ["#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#fb7185"];

/**
 * Chord diagram of pairwise return correlation. Ribbon width is proportional
 * to |correlation|; colour encodes the sign.
 *
 * d3-chord computes *angles* only — the ribbon and arc path strings come from
 * ribbon() and arc(). An earlier version read a non-existent `.ribbons`
 * property off the layout and expected `.path` on each entry, so this chart
 * threw on every render.
 */
export function ChordDiagram({ matrix, tickers, size = 480 }: Props) {
  const outerRadius = size / 2 - 56;
  const innerRadius = outerRadius - 12;

  const layout = useMemo(() => {
    const n = tickers?.length ?? 0;
    if (n < 2) return null;
    const valid =
      Array.isArray(matrix) && matrix.length === n && matrix.every((row) => Array.isArray(row) && row.length === n);
    if (!valid) return null;

    // The layout needs non-negative magnitudes; the sign is re-applied when
    // colouring. The epsilon keeps zero-correlation pairs from collapsing the
    // arc and producing NaN paths.
    const magnitude = matrix.map((row) => row.map((v) => Math.max(Math.abs(v ?? 0), 0.0001)));

    const chords = chord().padAngle(0.05)(magnitude);
    const ribbonPath = ribbon().radius(innerRadius);
    const arcPath = arc().innerRadius(innerRadius).outerRadius(outerRadius);

    return {
      ribbons: chords.map((c) => ({
        d: ribbonPath(c as never) as unknown as string | null,
        source: c.source.index,
        target: c.target.index,
      })),
      groups: chords.groups.map((g) => ({
        d: arcPath(g as never) as unknown as string | null,
        index: g.index,
        angle: (g.startAngle + g.endAngle) / 2,
      })),
    };
  }, [matrix, tickers, innerRadius, outerRadius]);

  if (!layout) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height: size }}>
        Need at least 2 tickers with overlapping history.
      </div>
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="max-w-full font-mono">
      <g transform={`translate(${size / 2},${size / 2})`}>
        {layout.ribbons.map((r, i) => {
          const corr = matrix[r.source]?.[r.target] ?? 0;
          const positive = corr >= 0;
          const fill = positive ? COLOR_PALETTE[r.source % COLOR_PALETTE.length] : "#ef4444";
          return (
            <path
              key={i}
              d={r.d ?? ""}
              fill={fill}
              fillOpacity={Math.max(0.12, Math.min(0.65, Math.abs(corr)))}
              stroke={fill}
              strokeOpacity={0.5}
            >
              <title>
                {tickers[r.source]} ↔ {tickers[r.target]}: {corr.toFixed(3)}
              </title>
            </path>
          );
        })}

        {layout.groups.map((g) => (
          <path
            key={`arc-${g.index}`}
            d={g.d ?? ""}
            fill={COLOR_PALETTE[g.index % COLOR_PALETTE.length]}
            fillOpacity={0.9}
          />
        ))}

        {layout.groups.map((g) => {
          // Angles start at 12 o'clock in d3; shift to screen coordinates.
          const a = g.angle - Math.PI / 2;
          const x = Math.cos(a) * (outerRadius + 10);
          const y = Math.sin(a) * (outerRadius + 10);
          return (
            <text
              key={`label-${g.index}`}
              x={x}
              y={y}
              fontSize="11"
              className="fill-muted-foreground"
              textAnchor={x > 1 ? "start" : x < -1 ? "end" : "middle"}
              dominantBaseline="middle"
            >
              {tickers[g.index]}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

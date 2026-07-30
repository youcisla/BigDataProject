// @ts-nocheck
"use client";

import { useMemo } from "react";
import { chord } from "d3-chord";

interface Props {
  /** Symmetric correlation matrix. matrix[i][j] in [-1, 1]. */
  matrix: number[][];
  tickers: string[];
  size?: number;
}

const COLOR_PALETTE = ["#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#fb7185"];

interface ChordRibbon {
  source: { index: number };
  target: { index: number };
  path?: string;
}

interface ChordGroup {
  index: number;
  path?: string;
}

interface ChordLayout {
  ribbons: ChordRibbon[];
  groups: ChordGroup[];
}

/**
 * Chord diagram showing correlation between tickers. Ribbon width is
 * proportional to |correlation|, color encodes sign (positive vs negative).
 */
export function ChordDiagram({ matrix, tickers, size = 480 }: Props) {
  const layout = useMemo<ChordLayout | null>(() => {
    if (!tickers || tickers.length < 2) return null;
    const n = tickers.length;
    const valid = Array.isArray(matrix) && matrix.length === n && matrix.every((row) => row.length === n);
    if (!valid) return null;
    const absMatrix = matrix.map((row) => row.map((v) => Math.max(Math.abs(v), 0.0001)));
    const result = chord().padAngle(0.04)(absMatrix) as unknown as {
      ribbons: ChordRibbon[];
      groups: ChordGroup[];
    };
    return { ribbons: result.ribbons, groups: result.groups };
  }, [matrix, tickers]);

  if (!layout) {
    return (
      <div className="flex h-[480px] items-center justify-center text-sm text-muted-foreground">
        Need at least 2 tickers for chord diagram.
      </div>
    );
  }

  const radius = size / 2 - 4;

  return (
    <svg width={size} height={size} className="font-mono">
      <g transform={`translate(${size / 2},${size / 2})`}>
        {layout.ribbons.map((d, i) => {
          const sourceIdx = d.source?.index ?? 0;
          const targetIdx = d.target?.index ?? 0;
          const sourceColor = COLOR_PALETTE[sourceIdx % COLOR_PALETTE.length];
          const corr = (matrix[sourceIdx]?.[targetIdx] ?? 0);
          const opacity = Math.max(0.15, Math.min(0.7, Math.abs(corr)));
          const stroke = corr >= 0 ? sourceColor : "#ef4444";
          return (
            <path
              key={i}
              d={d.path ?? ""}
              fill={sourceColor}
              fillOpacity={opacity * 0.6}
              stroke={stroke}
              strokeOpacity={0.8}
            />
          );
        })}
        {layout.groups.map((g, i) => (
          <path
            key={`arc-${i}`}
            d={g.path ?? ""}
            fill={COLOR_PALETTE[i % COLOR_PALETTE.length]}
            fillOpacity={0.9}
            stroke="#0f172a"
            strokeWidth={1}
          />
        ))}
        {tickers.map((t, i) => {
          const angle = (i / tickers.length) * 2 * Math.PI - Math.PI / 2;
          const x = Math.cos(angle) * (radius + 4);
          const y = Math.sin(angle) * (radius + 4);
          return (
            <text
              key={t}
              x={x}
              y={y}
              fontSize="11"
              fill="#cbd5e1"
              textAnchor={x > 0 ? "start" : "end"}
              dominantBaseline="middle"
            >
              {t}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

"use client";

import { useMemo } from "react";

interface Props {
  words: { text: string; value: number }[];
  width?: number;
  height?: number;
}

const PALETTE = ["#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#22d3ee"];

interface Placed {
  text: string;
  value: number;
  x: number;
  y: number;
  size: number;
  color: string;
}

/**
 * Spiral word cloud, rendered as plain SVG.
 *
 * Replaces react-wordcloud, which is built against d3 v5 and throws
 * "t.transition is not a function" against the d3 v3 packages this project
 * uses. Every other chart here is hand-rolled SVG anyway, so the dependency
 * bought nothing.
 */
export function WordCloud({ words, width = 720, height = 320 }: Props) {
  const placed = useMemo<Placed[]>(() => {
    if (!words || words.length === 0) return [];

    const top = [...words].sort((a, b) => b.value - a.value).slice(0, 60);
    const max = top[0]?.value ?? 1;
    const min = top[top.length - 1]?.value ?? 1;
    const scale = (v: number) => {
      if (max === min) return 24;
      // sqrt keeps the most frequent term from dwarfing everything else.
      return 12 + (Math.sqrt(v - min) / Math.sqrt(max - min)) * 34;
    };

    const out: Placed[] = [];
    const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const cx = width / 2;
    const cy = height / 2;

    for (let i = 0; i < top.length; i++) {
      const w = top[i];
      const size = scale(w.value);
      // Rough text metrics: good enough for collision avoidance without a
      // canvas measuring pass.
      const halfW = (w.text.length * size * 0.29) / 2;
      const halfH = size * 0.6;

      // Archimedean spiral outward from the centre until a free slot is found.
      for (let step = 0; step < 900; step++) {
        const angle = step * 0.35;
        const radius = step * 0.9;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * 0.62;

        const box = { x1: x - halfW, y1: y - halfH, x2: x + halfW, y2: y + halfH };
        if (box.x1 < 4 || box.y1 < 4 || box.x2 > width - 4 || box.y2 > height - 4) continue;

        const hits = boxes.some(
          (b) => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2),
        );
        if (hits) continue;

        boxes.push(box);
        out.push({ text: w.text, value: w.value, x, y, size, color: PALETTE[i % PALETTE.length] });
        break;
      }
    }
    return out;
  }, [words, width, height]);

  if (placed.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No headlines to summarize yet.
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Word cloud of ${placed.length} headline terms`}
    >
      {placed.map((w) => (
        <text
          key={w.text}
          x={w.x}
          y={w.y}
          fontSize={w.size}
          fontWeight={w.size > 30 ? 700 : 500}
          fill={w.color}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {w.text}
          <title>{`${w.text}: ${w.value.toLocaleString()} mentions`}</title>
        </text>
      ))}
    </svg>
  );
}

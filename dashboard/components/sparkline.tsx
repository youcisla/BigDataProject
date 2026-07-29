"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface Props {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  className?: string;
}

export function Sparkline({
  values,
  width = 120,
  height = 32,
  stroke = "currentColor",
  fill = "currentColor",
  className,
}: Props) {
  const path = useMemo(() => {
    if (values.length < 2) return { line: "", area: "" };
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const stepX = width / (values.length - 1);

    const points = values.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return [x, y] as const;
    });

    const line = points
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");

    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area };
  }, [values, width, height]);

  if (values.length < 2) {
    return (
      <div className={cn("flex items-center text-xs text-muted-foreground", className)} style={{ width, height }}>
        <span className="opacity-50">awaiting data...</span>
      </div>
    );
  }

  const id = `sparkline-grad-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.3" />
          <stop offset="100%" stopColor={fill} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path.area} fill={`url(#${id})`} />
      <path d={path.line} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type SeriesMarker,
} from "lightweight-charts";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export interface Bar extends Candle {
  ts: string;
}

export interface NewsMarker {
  date: string;
  headline: string;
  sentiment?: number | null;
}

/**
 * Bar intervals. `1d` always exists (the Kaggle archive); the sub-daily ones
 * exist only for tickers that `scripts/fetch_intraday.py` has covered, so the
 * parent passes `availableIntervals` and the rest render disabled with a
 * tooltip rather than silently doing nothing.
 */
const INTERVALS = [
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1H" },
  { id: "1d", label: "1D" },
] as const;

type IntervalId = (typeof INTERVALS)[number]["id"];

/** Trailing windows in days. -1 is year-to-date, null the full history. */
const RANGES = [
  { id: "1D", days: 1 },
  { id: "5D", days: 5 },
  { id: "1M", days: 31 },
  { id: "3M", days: 92 },
  { id: "6M", days: 183 },
  { id: "YTD", days: -1 },
  { id: "1Y", days: 365 },
  { id: "5Y", days: 1826 },
  { id: "ALL", days: null },
] as const;

type RangeId = (typeof RANGES)[number]["id"];
type ChartKind = "candles" | "line" | "area";

/** Ranges too short to show anything at a given interval, and vice versa. */
function rangesFor(interval: IntervalId): RangeId[] {
  switch (interval) {
    case "1m":
      return ["1D", "5D"]; // Yahoo serves ~7 calendar days of 1m
    case "5m":
    case "15m":
      return ["1D", "5D", "1M"]; // ~60 days
    case "1h":
      return ["5D", "1M", "3M", "6M", "YTD", "1Y"]; // ~730 days
    default:
      return ["1M", "3M", "6M", "YTD", "1Y", "5Y", "ALL"];
  }
}

export function TradingChart({
  data,
  news = [],
  ticker,
  availableIntervals = [],
  height = 420,
  showVolume = true,
}: {
  data: Candle[];
  news?: NewsMarker[];
  ticker?: string;
  availableIntervals?: string[];
  height?: number;
  showVolume?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const [interval, setInterval] = useState<IntervalId>("1d");
  const [range, setRange] = useState<RangeId>("1Y");
  const [kind, setKind] = useState<ChartKind>("candles");
  const [withNews, setWithNews] = useState(true);

  const [intraday, setIntraday] = useState<Bar[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch bars when the interval changes. `1d` is already in props.
  useEffect(() => {
    if (interval === "1d" || !ticker) {
      setIntraday([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/intraday?ticker=${encodeURIComponent(ticker)}&interval=${interval}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((j) => setIntraday(j.bars ?? []))
      .catch(() => {
        if (!controller.signal.aborted) setIntraday([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ticker, interval]);

  // Keep the range legal for the interval when the interval changes.
  useEffect(() => {
    const allowed = rangesFor(interval);
    if (!allowed.includes(range)) setRange(allowed[allowed.length - 1]);
  }, [interval, range]);

  const series = useMemo<{ time: number; iso: string; bar: Candle }[]>(() => {
    if (interval === "1d") {
      return data.map((d) => ({
        time: Date.parse(`${d.date}T00:00:00Z`) / 1000,
        iso: d.date,
        bar: d,
      }));
    }
    return intraday.map((b) => ({ time: Date.parse(b.ts) / 1000, iso: b.ts, bar: b }));
  }, [interval, data, intraday]);

  const visible = useMemo(() => {
    if (series.length === 0) return [];
    const spec = RANGES.find((r) => r.id === range)!;
    if (spec.days === null) return series;

    const lastMs = series[series.length - 1].time * 1000;
    const last = new Date(lastMs);
    const cutoff =
      spec.days === -1
        ? Date.UTC(last.getUTCFullYear(), 0, 1)
        : lastMs - spec.days * 86_400_000;
    return series.filter((p) => p.time * 1000 >= cutoff);
  }, [series, range]);

  useEffect(() => {
    if (!containerRef.current || visible.length === 0) return;

    const dark = document.documentElement.classList.contains("dark");
    const grid = dark ? "#1e293b" : "#e2e8f0";
    const text = dark ? "#94a3b8" : "#64748b";
    const intradayMode = interval !== "1d";

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: text },
      grid: {
        vertLines: { color: grid, style: LineStyle.Dotted },
        horzLines: { color: grid, style: LineStyle.Dotted },
      },
      timeScale: { borderColor: grid, timeVisible: intradayMode, secondsVisible: false, rightOffset: 4 },
      rightPriceScale: {
        borderColor: grid,
        scaleMargins: { top: 0.1, bottom: showVolume ? 0.3 : 0.1 },
      },
      crosshair: { mode: 1 },
      localization: { priceFormatter: (p: number) => p.toFixed(p < 10 ? 4 : 2) },
    });

    let priceSeries: ISeriesApi<"Candlestick" | "Line" | "Area">;
    if (kind === "candles") {
      const s = chart.addCandlestickSeries({
        upColor: "#10b981",
        downColor: "#ef4444",
        borderUpColor: "#10b981",
        borderDownColor: "#ef4444",
        wickUpColor: "#10b981",
        wickDownColor: "#ef4444",
      });
      s.setData(
        visible.map((p) => ({
          time: p.time as Time,
          open: p.bar.open,
          high: p.bar.high,
          low: p.bar.low,
          close: p.bar.close,
        })),
      );
      priceSeries = s;
    } else if (kind === "line") {
      const s = chart.addLineSeries({ color: "#3b82f6", lineWidth: 2 });
      s.setData(visible.map((p) => ({ time: p.time as Time, value: p.bar.close })));
      priceSeries = s;
    } else {
      const s = chart.addAreaSeries({
        lineColor: "#3b82f6",
        topColor: "rgba(59,130,246,0.4)",
        bottomColor: "rgba(59,130,246,0.02)",
        lineWidth: 2,
      });
      s.setData(visible.map((p) => ({ time: p.time as Time, value: p.bar.close })));
      priceSeries = s;
    }

    if (showVolume && visible.some((p) => p.bar.volume)) {
      const volume = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
      volume.setData(
        visible.map((p) => ({
          time: p.time as Time,
          value: p.bar.volume ?? 0,
          color: p.bar.close >= p.bar.open ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)",
        })),
      );
    }

    // News is dated, not timestamped, so markers only make sense on daily bars.
    if (withNews && !intradayMode && news.length > 0) {
      const inRange = new Set(visible.map((p) => p.iso));
      const byDate = new Map<string, NewsMarker[]>();
      for (const n of news) {
        if (!inRange.has(n.date)) continue;
        if (!byDate.has(n.date)) byDate.set(n.date, []);
        byDate.get(n.date)!.push(n);
      }

      const markers: SeriesMarker<Time>[] = Array.from(byDate.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, items]) => {
          const scored = items.filter((i) => typeof i.sentiment === "number");
          const avg = scored.length
            ? scored.reduce((s, i) => s + (i.sentiment ?? 0), 0) / scored.length
            : null;
          const colour =
            avg === null ? "#64748b" : avg > 0.15 ? "#10b981" : avg < -0.15 ? "#ef4444" : "#f59e0b";
          return {
            time: (Date.parse(`${date}T00:00:00Z`) / 1000) as Time,
            position: "aboveBar" as const,
            color: colour,
            shape: "circle" as const,
            text: items.length > 1 ? `${items.length} news` : items[0].headline.slice(0, 40),
          };
        });
      priceSeries.setMarkers(markers);
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const resize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.remove();
      chartRef.current = null;
    };
  }, [visible, kind, height, showVolume, withNews, news, interval]);

  const stats = useMemo(() => {
    if (visible.length < 2) return null;
    const first = visible[0].bar;
    const last = visible[visible.length - 1].bar;
    return {
      change: ((last.close - first.close) / first.close) * 100,
      high: Math.max(...visible.map((p) => p.bar.high)),
      low: Math.min(...visible.map((p) => p.bar.low)),
      bars: visible.length,
    };
  }, [visible]);

  const allowedRanges = rangesFor(interval);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Bar interval">
          {INTERVALS.map((iv) => {
            const usable = iv.id === "1d" || availableIntervals.includes(iv.id);
            return (
              <button
                key={iv.id}
                onClick={() => usable && setInterval(iv.id)}
                disabled={!usable}
                aria-pressed={interval === iv.id}
                title={usable ? undefined : `No ${iv.label} bars ingested for this symbol`}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  interval === iv.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  !usable && "cursor-not-allowed opacity-35 hover:bg-transparent",
                )}
              >
                {iv.label}
              </button>
            );
          })}
        </div>

        <div className="flex rounded-md border p-0.5" role="group" aria-label="Range">
          {RANGES.filter((r) => allowedRanges.includes(r.id)).map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              aria-pressed={range === r.id}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                range === r.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {r.id}
            </button>
          ))}
        </div>

        <div className="flex rounded-md border p-0.5" role="group" aria-label="Chart type">
          {(["candles", "line", "area"] as ChartKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                kind === k
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {k}
            </button>
          ))}
        </div>

        {news.length > 0 && interval === "1d" && (
          <button
            onClick={() => setWithNews((v) => !v)}
            aria-pressed={withNews}
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
              withNews
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            News markers
          </button>
        )}

        {stats && (
          <div className="ml-auto flex items-center gap-3 font-mono text-xs">
            <span className="text-muted-foreground">{stats.bars.toLocaleString()} bars</span>
            <span className="text-muted-foreground">H {stats.high.toFixed(2)}</span>
            <span className="text-muted-foreground">L {stats.low.toFixed(2)}</span>
            <span className={cn("font-semibold", stats.change >= 0 ? "text-emerald-500" : "text-red-500")}>
              {stats.change >= 0 ? "+" : ""}
              {stats.change.toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <div
          className="flex items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground"
          style={{ height }}
        >
          <Loader2 className="h-4 w-4 animate-spin" /> Loading {interval} bars…
        </div>
      ) : visible.length === 0 ? (
        <div
          className="flex items-center justify-center rounded-md border border-dashed px-6 text-center text-sm text-muted-foreground"
          style={{ height }}
        >
          {interval === "1d"
            ? "No price data in this window."
            : `No ${interval} bars ingested for ${ticker ?? "this symbol"}. Run: make intraday`}
        </div>
      ) : (
        <div ref={containerRef} style={{ width: "100%", height }} />
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { motion } from "framer-motion";
import { ArrowRight, Database, GitBranch, Loader2, Settings as SettingsIcon, Sparkles, TerminalSquare, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { HistogramChart } from "@/components/viz/histogram";
import { RidgelineChart } from "@/components/viz/ridgeline";
import { ChordDiagram } from "@/components/viz/chord";
import { RadarChart } from "@/components/viz/radar";
import { WordCloud } from "@/components/viz/word-cloud";
import { BubbleMap } from "@/components/viz/bubble-map";
import { fadeInUp, stagger } from "@/lib/animations";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface SymbolSummary {
  ticker: string;
  source: string;
  ohlcv_rows: number;
  news_rows: number;
  first_date: string;
  last_date: string;
  latest_close: number | null;
}

interface ComparePayload {
  tickers: string[];
  returns: { ticker: string; date: string; return_pct: number }[];
  metrics: { ticker: string; mean_return: number | null; volatility: number | null; total_news: number; latest_close: number | null }[];
  prices: { ticker: string; date: string; close: number; volume: number | null }[];
  words: { text: string; value: number }[];
  correlation: { tickers: string[]; matrix: number[][] };
}

const NAV = [
  { id: "overview", label: "Overview", icon: Sparkles, href: "/#overview" },
  { id: "pipeline", label: "Pipeline", icon: GitBranch, href: "/#pipeline" },
  { id: "analysis", label: "Analysis", icon: Eye, href: "/analysis" },
  { id: "logs", label: "Logs", icon: TerminalSquare, href: "/#logs" },
  { id: "settings", label: "Settings", icon: SettingsIcon, href: "/#settings" },
];

const MAX_SELECTED = 6;

export default function AnalysisPage() {
  const [symbols, setSymbols] = useState<SymbolSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [compare, setCompare] = useState<ComparePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/symbols")
      .then((r) => r.json())
      .then((j) => {
        const all: SymbolSummary[] = j.symbols ?? [];
        setSymbols(all);
        // Auto-select 3 symbols that actually have OHLCV rows (skip zero-row symbols).
        const withData = all.filter((s) => s.ohlcv_rows > 0);
        setSelected(withData.slice(0, 3).map((s) => s.ticker));
      })
      .catch(() => setSymbols([]));
  }, []);

  useEffect(() => {
    if (selected.length < 2) {
      setCompare(null);
      return;
    }
    // Abort the previous request so a slow response cannot overwrite a newer one.
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/compare?tickers=${selected.join(",")}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => setCompare(j.error ? null : j))
      .catch(() => {
        if (!controller.signal.aborted) setCompare(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selected]);

  const toggle = (t: string) => {
    setSelected((prev) =>
      prev.includes(t)
        ? prev.filter((x) => x !== t)
        : prev.length >= MAX_SELECTED
          ? prev
          : [...prev, t],
    );
  };

  // The Gold layer carries hundreds of tickers; render a filtered slice, not all
  // of them. Selected tickers always stay visible so they can be toggled off.
  const visibleSymbols = useMemo(() => {
    const q = query.trim().toUpperCase();
    const matches = symbols.filter(
      (s) => s.ohlcv_rows > 0 && (!q || s.ticker.includes(q)),
    );
    const shown = matches.slice(0, 60);
    const missing = symbols.filter(
      (s) => selected.includes(s.ticker) && !shown.some((x) => x.ticker === s.ticker),
    );
    return { shown: [...missing, ...shown], total: matches.length };
  }, [symbols, query, selected]);

  const returns = compare?.returns ?? [];
  const selectedMetrics = compare?.metrics ?? [];
  const histogramData = returns.map((r) => ({ ticker: r.ticker, value: r.return_pct }));
  const ridgelineData = selected.map((t) => ({
    ticker: t,
    values: returns.filter((r) => r.ticker === t).map((r) => r.return_pct),
  }));
  const radarData = selectedMetrics.map((m) => ({
    ticker: m.ticker,
    values: {
      "Mean Return": Math.min(1, Math.max(0, ((m.mean_return ?? 0) + 5) / 10)),
      Volatility: Math.min(1, Math.max(0, ((m.volatility ?? 0) / 5))),
      "News Volume": Math.min(1, Math.max(0, (m.total_news ?? 0) / 100)),
      "Latest Price": Math.min(1, Math.max(0, ((m.latest_close ?? 0) / 500))),
    },
  }));

  // Join returns to real close/volume from daily_prices. These used to be
  // derived from return_pct itself, which made the bubble sizes meaningless.
  const bubbleData = useMemo(() => {
    const priceByKey = new Map(
      (compare?.prices ?? []).map((p) => [`${p.ticker}|${p.date}`, p]),
    );
    return returns
      .map((r) => {
        const p = priceByKey.get(`${r.ticker}|${r.date}`);
        if (!p) return null;
        return {
          date: r.date,
          close: p.close,
          volume: p.volume ?? 0,
          return_pct: r.return_pct,
          ticker: r.ticker,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .slice(-200);
  }, [returns, compare?.prices]);

  return (
    <>
      <Head>
        <title>BigData Pipeline — Analysis</title>
      </Head>
      <main className="min-h-screen bg-background text-foreground">
        <div className="grid min-h-screen grid-cols-[260px_1fr]">
          {/* Sidebar */}
          <aside className="border-r bg-card/30 backdrop-blur-sm flex flex-col sticky top-0 h-screen">
            <div className="p-6 border-b">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/30">
                  <Database className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h1 className="text-base font-semibold leading-tight">BigData Pipeline</h1>
                  <p className="text-xs text-muted-foreground">Medallion dashboard</p>
                </div>
              </div>
            </div>

            <nav className="flex-1 p-3 space-y-1">
              {NAV.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all",
                    item.id === "analysis"
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>

          {/* Main */}
          <div className="overflow-auto">
            <motion.header
              initial="hidden"
              animate="visible"
              variants={fadeInUp}
              className="sticky top-0 z-10 backdrop-blur-md bg-background/80 border-b px-8 py-4"
            >
              <h2 className="text-2xl font-bold tracking-tight">Analysis</h2>
              <p className="text-sm text-muted-foreground">
                Compare symbols across 6 visualizations. Pick 2-6 tickers below.
              </p>
            </motion.header>

            <motion.div
              initial="hidden"
              animate="visible"
              variants={stagger}
              className="p-8 space-y-6 max-w-7xl"
            >
              {/* Symbol selector */}
              <motion.div variants={fadeInUp}>
                <Card>
                  <CardHeader>
                    <CardTitle>Select symbols</CardTitle>
                    <CardDescription>
                      Pick 2 to 6 tickers. Each shows its source, row count, and date range.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Filter tickers..."
                      aria-label="Filter tickers"
                      className="mb-3 w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="flex flex-wrap gap-2">
                      {symbols.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Loading symbols... (or run the pipeline first)
                        </p>
                      ) : visibleSymbols.shown.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No ticker matches &ldquo;{query}&rdquo;.
                        </p>
                      ) : (
                        visibleSymbols.shown.map((s) => {
                          const isOn = selected.includes(s.ticker);
                          const disabled = !isOn && selected.length >= MAX_SELECTED;
                          return (
                            <button
                              key={`${s.ticker}-${s.source}`}
                              onClick={() => toggle(s.ticker)}
                              disabled={disabled}
                              aria-pressed={isOn}
                              className={cn(
                                "rounded-md border px-3 py-2 text-sm transition-all text-left",
                                isOn
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "hover:bg-accent hover:text-accent-foreground",
                                disabled && "opacity-40 cursor-not-allowed"
                              )}
                            >
                              <div className="font-semibold">{s.ticker}</div>
                              <div className="text-[10px] opacity-70 mt-0.5">
                                {s.ohlcv_rows.toLocaleString()} rows - {s.source.includes("etf") ? "ETF" : s.source.includes("crypto") ? "Crypto" : "Stock"}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                    {visibleSymbols.total > visibleSymbols.shown.length && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Showing {visibleSymbols.shown.length} of {visibleSymbols.total.toLocaleString()} tickers. Type to narrow.
                      </p>
                    )}
                    {selected.length > 0 && (
                      <div className="mt-3 text-xs text-muted-foreground">
                        Selected ({selected.length}/{MAX_SELECTED}): {selected.join(", ")}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>

              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Computing correlations...
                </div>
              )}

              {compare && selected.length >= 2 && (
                <>
                  {/* Row 1: histogram + ridgeline */}
                  <motion.div variants={fadeInUp} className="grid gap-6 lg:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Returns distribution</CardTitle>
                        <CardDescription>Histogram of daily returns per ticker.</CardDescription>
                      </CardHeader>
                      <CardContent className="overflow-x-auto">
                        <HistogramChart data={histogramData} width={500} height={260} />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Returns density (ridgeline)</CardTitle>
                        <CardDescription>Distribution shape per ticker.</CardDescription>
                      </CardHeader>
                      <CardContent className="overflow-x-auto">
                        <RidgelineChart data={ridgelineData} width={500} height={260} />
                      </CardContent>
                    </Card>
                  </motion.div>

                  {/* Row 2: chord + radar */}
                  <motion.div variants={fadeInUp} className="grid gap-6 lg:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Co-movement (chord)</CardTitle>
                        <CardDescription>
                          Ribbons = correlation. Green = positive, red = negative.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ChordDiagram matrix={compare.correlation.matrix} tickers={compare.correlation.tickers} />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Multi-metric radar</CardTitle>
                        <CardDescription>
                          Mean return, volatility, news volume, latest price.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <RadarChart data={radarData} metrics={["Mean Return", "Volatility", "News Volume", "Latest Price"]} />
                      </CardContent>
                    </Card>
                  </motion.div>

                  {/* Row 3: bubble map full width */}
                  <motion.div variants={fadeInUp}>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Bubble map: date vs return %, size = volume, color = sign</CardTitle>
                        <CardDescription>
                          Each bubble is one trading day, joined to its real close and volume from the Gold layer.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="overflow-x-auto">
                        {bubbleData.length === 0 ? (
                          <p className="py-8 text-center text-sm text-muted-foreground">
                            No overlapping price rows for the selected tickers.
                          </p>
                        ) : (
                          <BubbleMap data={bubbleData} />
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>

                  {/* Row 4: word cloud over the crypto headlines */}
                  <motion.div variants={fadeInUp}>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Headline terms (word cloud)</CardTitle>
                        <CardDescription>
                          Most frequent terms in the crypto news headlines ingested for the selected tickers.
                          Stock tickers carry no headlines in this dataset.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <WordCloud words={compare.words ?? []} />
                      </CardContent>
                    </Card>
                  </motion.div>

                  {/* Symbol detail links */}
                  <motion.div variants={fadeInUp}>
                    <Card>
                      <CardHeader>
                        <CardTitle>Symbol detail</CardTitle>
                        <CardDescription>
                          Click a ticker to see its full OHLCV chart, news, and stats.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-wrap gap-2">
                          {selected.map((t) => (
                            <Link key={t} href={`/symbol/${t}`}>
                              <Button variant="outline" size="sm">
                                {t}
                                <ArrowRight className="h-3 w-3 ml-1" />
                              </Button>
                            </Link>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                </>
              )}

              {selected.length < 2 && symbols.length > 0 && (
                <motion.div variants={fadeInUp}>
                  <Card className="border-dashed">
                    <CardContent className="py-12 text-center text-muted-foreground">
                      Select at least 2 symbols above to see comparative analysis.
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </motion.div>
          </div>
        </div>
      </main>
    </>
  );
}

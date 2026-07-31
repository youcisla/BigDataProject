"use client";

import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, FileText, Loader2, Newspaper } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TradingChart } from "@/components/viz/trading-chart";
import { SentimentImpact } from "@/components/viz/sentiment-impact";
import { NewsPanel, type Headline } from "@/components/news-panel";
import { fadeInUp, stagger } from "@/lib/animations";
import { cn } from "@/lib/utils";

interface OhlcvRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  source: string;
}

interface SentimentPoint {
  date: string;
  avg_sentiment: number | null;
  headline_count: number;
  return_pct: number | null;
}

interface SymbolData {
  ticker: string;
  ohlcv: OhlcvRow[];
  headlines: Headline[];
  sentiment: SentimentPoint[];
  intervals: string[];
}

export default function SymbolPage() {
  const router = useRouter();
  const { ticker } = router.query;
  const [data, setData] = useState<SymbolData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/symbol/${ticker}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ticker]);

  const stats = useMemo(() => {
    if (!data || data.ohlcv.length === 0) return null;
    const first = data.ohlcv[0];
    const last = data.ohlcv[data.ohlcv.length - 1];
    const scored = data.headlines.filter((h) => h.sentiment != null);
    const avgSentiment = scored.length
      ? scored.reduce((s, h) => s + (h.sentiment ?? 0), 0) / scored.length
      : null;
    return {
      last: last.close,
      totalReturn: ((last.close - first.close) / first.close) * 100,
      days: data.ohlcv.length,
      news: data.headlines.length,
      avgSentiment,
      from: first.date,
      to: last.date,
      sources: Array.from(new Set(data.ohlcv.map((o) => o.source))),
    };
  }, [data]);

  const title = typeof ticker === "string" ? ticker.toUpperCase() : "Symbol";

  if (loading) {
    return (
      <AppShell active="analysis" title={title} subtitle="Loading symbol…">
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the warehouse…
        </div>
      </AppShell>
    );
  }

  if (error || !data || data.ohlcv.length === 0) {
    return (
      <AppShell active="analysis" title={title} subtitle="Symbol detail">
        <Card className="max-w-2xl">
          <CardContent className="py-12 text-center">
            <p className="text-destructive">{error ?? "No price rows for this symbol."}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {title} may not have been ingested. Run the bulk loader to add it.
            </p>
            <Link href="/analysis" className="mt-4 inline-block">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to analysis
              </Button>
            </Link>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <>
      <Head>
        <title>{data.ticker} — BigData Pipeline</title>
      </Head>
      <AppShell
        active="analysis"
        title={data.ticker}
        subtitle={stats ? `${stats.from} → ${stats.to} · ${stats.days.toLocaleString()} trading days` : undefined}
        actions={
          <Link href="/analysis">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Analysis
            </Button>
          </Link>
        }
      >
        <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-4">
          {/* Bento row: stats tiles */}
          <motion.section
            variants={fadeInUp}
            className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
          >
            <Stat label="Latest close" value={stats!.last.toFixed(2)} mono />
            <Stat
              label="Total return"
              value={`${stats!.totalReturn >= 0 ? "+" : ""}${stats!.totalReturn.toFixed(2)}%`}
              tone={stats!.totalReturn >= 0 ? "up" : "down"}
              mono
            />
            <Stat label="Trading days" value={stats!.days.toLocaleString()} mono />
            <Stat label="Headlines" value={stats!.news.toLocaleString()} mono />
            <Stat
              label="Avg sentiment"
              value={stats!.avgSentiment == null ? "—" : stats!.avgSentiment.toFixed(3)}
              tone={
                stats!.avgSentiment == null
                  ? undefined
                  : stats!.avgSentiment > 0.15
                    ? "up"
                    : stats!.avgSentiment < -0.15
                      ? "down"
                      : undefined
              }
              mono
            />
          </motion.section>

          {/* Bento: chart spans 2/3, news rail 1/3 */}
          <motion.section variants={fadeInUp} className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  Price &amp; volume
                  <Badge variant="secondary" className="text-[10px]">
                    TradingView Lightweight Charts
                  </Badge>
                  {stats!.sources.map((s) => (
                    <Badge key={s} variant="outline" className="font-mono text-[10px]">
                      {s}
                    </Badge>
                  ))}
                </CardTitle>
                <CardDescription>
                  Daily OHLCV from the Gold layer. Dots above the bars mark days with news, coloured by tone.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TradingChart
                  ticker={data.ticker}
                  availableIntervals={data.intervals ?? []}
                  data={data.ohlcv}
                  news={data.headlines.map((h) => ({
                    date: h.date,
                    headline: h.headline,
                    sentiment: h.sentiment,
                  }))}
                  height={440}
                />
              </CardContent>
            </Card>

            <Card className="xl:col-span-1">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Newspaper className="h-4 w-4" /> News
                </CardTitle>
                <CardDescription>Filter by tone, text, or date.</CardDescription>
              </CardHeader>
              <CardContent>
                <NewsPanel headlines={data.headlines} maxHeight={430} />
              </CardContent>
            </Card>
          </motion.section>

          {/* Bento: sentiment impact + provenance */}
          <motion.section variants={fadeInUp} className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Does the news move the price?</CardTitle>
                <CardDescription>
                  Each bubble is one day: news tone against the <em>next</em> day&rsquo;s return.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SentimentImpact data={data.sentiment ?? []} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" /> Provenance
                </CardTitle>
                <CardDescription>Where this symbol&rsquo;s data came from.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="OHLCV source" value={stats!.sources.join(", ")} />
                <Row label="Coverage" value={`${stats!.from} → ${stats!.to}`} />
                <Row label="News feeds" value="Yahoo Finance RSS, CoinDesk, CoinTelegraph, Nasdaq" />
                <Row label="Sentiment" value="VADER compound, computed in the Gold job" />
                <p className="pt-2 text-xs text-muted-foreground">
                  Not included: fundamentals (P/E, EPS), intraday prices, analyst ratings, SEC filings.
                  This is an exploratory view of the ingested dataset, not investment advice.
                </p>
              </CardContent>
            </Card>
          </motion.section>
        </motion.div>
      </AppShell>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-bold",
          mono && "font-mono tabular-nums",
          tone === "up" && "text-emerald-500",
          tone === "down" && "text-red-500",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-xs">{value}</span>
    </div>
  );
}

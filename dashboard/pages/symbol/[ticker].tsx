"use client";

import { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, ExternalLink, FileText, Newspaper } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PriceChart } from "@/components/viz/price-chart";
import { fadeInUp } from "@/lib/animations";
import { formatRelative } from "@/lib/time";
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

interface Headline {
  date: string;
  ticker: string;
  headline: string;
  source: string;
}

interface SymbolData {
  ticker: string;
  ohlcv: OhlcvRow[];
  headlines: Headline[];
}

export default function SymbolPage() {
  const router = useRouter();
  const { ticker } = router.query;
  const [data, setData] = useState<SymbolData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    fetch(`/api/symbol/${ticker}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => setData(j))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading {String(ticker)}...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen p-8">
        <Head><title>{String(ticker)} - BigData Pipeline</title></Head>
        <div className="max-w-2xl mx-auto">
          <Link href="/analysis">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Analysis
            </Button>
          </Link>
          <Card className="mt-4">
            <CardContent className="py-12 text-center">
              <p className="text-destructive">{error ?? "Symbol not found"}</p>
              <p className="text-sm text-muted-foreground mt-2">
                {String(ticker)} may not have been ingested. Run the bulk loader to add it.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const last = data.ohlcv[data.ohlcv.length - 1];
  const first = data.ohlcv[0];
  const totalReturn = last && first ? ((last.close - first.close) / first.close) * 100 : 0;

  // Sources attribution: distinct sources used in the OHLCV data
  const sources = Array.from(new Set(data.ohlcv.map((o) => o.source)));

  return (
    <>
      <Head>
        <title>{data.ticker} - BigData Pipeline</title>
      </Head>
      <main className="min-h-screen bg-background text-foreground">
        <div className="max-w-7xl mx-auto p-8 space-y-6">
          <motion.div initial="hidden" animate="visible" variants={fadeInUp}>
            <Link href="/analysis">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" /> Back to Analysis
              </Button>
            </Link>
          </motion.div>

          <motion.div initial="hidden" animate="visible" variants={fadeInUp}>
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <h1 className="text-4xl font-bold tracking-tight">{data.ticker}</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {first && last ? `${first.date} to ${last.date} - ${data.ohlcv.length} trading days` : "No data"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {sources.map((s) => (
                  <Badge key={s} variant="secondary" className="font-mono text-xs">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Stats row */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeInUp}
            className="grid grid-cols-2 md:grid-cols-4 gap-3"
          >
            <div className="rounded-lg border bg-card/40 backdrop-blur-sm p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Latest Close
              </div>
              <div className="text-2xl font-bold font-mono mt-1">
                {last?.close.toFixed(2) ?? "-"}
              </div>
            </div>
            <div className="rounded-lg border bg-card/40 backdrop-blur-sm p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Total Return
              </div>
              <div className={cn(
                "text-2xl font-bold font-mono mt-1",
                totalReturn >= 0 ? "text-emerald-500" : "text-red-500"
              )}>
                {totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(2)}%
              </div>
            </div>
            <div className="rounded-lg border bg-card/40 backdrop-blur-sm p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Days Tracked
              </div>
              <div className="text-2xl font-bold font-mono mt-1">
                {data.ohlcv.length.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg border bg-card/40 backdrop-blur-sm p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                News Headlines
              </div>
              <div className="text-2xl font-bold font-mono mt-1">
                {data.headlines.length.toLocaleString()}
              </div>
            </div>
          </motion.div>

          {/* Price chart */}
          <motion.div initial="hidden" animate="visible" variants={fadeInUp}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Price (OHLCV)
                  <Badge variant="secondary" className="text-xs">TradingView Lightweight Charts</Badge>
                </CardTitle>
                <CardDescription>
                  Daily open / high / low / close. Source: {sources.join(", ")}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PriceChart data={data.ohlcv} />
              </CardContent>
            </Card>
          </motion.div>

          {/* News headlines */}
          <motion.div initial="hidden" animate="visible" variants={fadeInUp}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Newspaper className="h-4 w-4" /> Recent news headlines
                </CardTitle>
                <CardDescription>
                  {data.headlines.length} headlines embedded in the source dataset.
                  Only available for crypto tickers (CryptoDataDownload bundles news with OHLCV).
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.headlines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No news headlines in the source dataset for this ticker.
                  </p>
                ) : (
                  <ul className="space-y-2 max-h-[500px] overflow-y-auto">
                    {data.headlines.map((h, i) => (
                      <li key={i} className="border-l-2 border-muted pl-3 py-1">
                        <div className="text-xs text-muted-foreground">
                          {h.date} - {h.source}
                        </div>
                        <div className="text-sm">{h.headline}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Source attribution */}
          <motion.div initial="hidden" animate="visible" variants={fadeInUp}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Source attribution
                </CardTitle>
                <CardDescription>Where this data came from.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  OHLCV source: <code className="font-mono text-xs">{sources[0]}</code> (CryptoDataDownload archive)
                </p>
                <p>
                  News headlines: embedded in the same CryptoDataDownload CSV (column <code className="font-mono text-xs">articles</code>).
                </p>
                <p className="text-xs text-muted-foreground">
                  Scope: every ticker present in the ingested archives. Restrict a run by passing
                  a <code className="font-mono text-xs">--tickers-file</code> (one symbol per line)
                  to <code className="font-mono text-xs">scripts/fetch_stocks.py</code>.
                </p>
                <p className="text-xs text-muted-foreground">
                  What's NOT included: fundamentals (P/E, EPS), real-time prices, analyst ratings, SEC filings.
                  We don't have a paid data feed.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </main>
    </>
  );
}

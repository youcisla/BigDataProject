"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Newspaper } from "lucide-react";

import { cn } from "@/lib/utils";

export interface Headline {
  date: string;
  ticker: string;
  headline: string;
  source: string;
  url: string | null;
  sentiment: number | null;
  sentiment_label: string | null;
}

type Tone = "all" | "positive" | "neutral" | "negative";

const TONES: { id: Tone; label: string; dot: string }[] = [
  { id: "all", label: "All", dot: "bg-muted-foreground" },
  { id: "positive", label: "Positive", dot: "bg-emerald-500" },
  { id: "neutral", label: "Neutral", dot: "bg-amber-500" },
  { id: "negative", label: "Negative", dot: "bg-red-500" },
];

function toneOf(h: Headline): Tone {
  if (h.sentiment_label === "positive" || h.sentiment_label === "negative" || h.sentiment_label === "neutral") {
    return h.sentiment_label;
  }
  if (h.sentiment == null) return "neutral";
  return h.sentiment > 0.15 ? "positive" : h.sentiment < -0.15 ? "negative" : "neutral";
}

/** Per-symbol news feed with sentiment badges and tone/date/text filters. */
export function NewsPanel({ headlines, maxHeight = 520 }: { headlines: Headline[]; maxHeight?: number }) {
  const [tone, setTone] = useState<Tone>("all");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return headlines.filter((h) => {
      if (tone !== "all" && toneOf(h) !== tone) return false;
      if (from && h.date < from) return false;
      if (to && h.date > to) return false;
      if (q && !h.headline.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [headlines, tone, query, from, to]);

  const counts = useMemo(() => {
    const c = { positive: 0, neutral: 0, negative: 0 };
    for (const h of headlines) c[toneOf(h) as keyof typeof c]++;
    return c;
  }, [headlines]);

  if (headlines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Newspaper className="h-5 w-5" />
        No headlines ingested for this symbol.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          {TONES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTone(t.id)}
              aria-pressed={tone === t.id}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                tone === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />
              {t.label}
              {t.id !== "all" && (
                <span className="tabular-nums opacity-70">{counts[t.id as keyof typeof counts]}</span>
              )}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search headlines…"
          aria-label="Search headlines"
          className="w-44 rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="News from date"
            className="rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span>→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="News to date"
            className="rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {filtered.length} / {headlines.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No headline matches these filters.</p>
      ) : (
        <ul className="space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight }}>
          {filtered.map((h, i) => {
            const t = toneOf(h);
            return (
              <li
                key={`${h.date}-${i}`}
                className="rounded-md px-2 py-1.5 transition-colors hover:bg-accent/40"
              >
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      t === "positive" && "bg-emerald-500",
                      t === "negative" && "bg-red-500",
                      t === "neutral" && "bg-amber-500/70",
                    )}
                  />
                  <span className="font-mono">{h.date}</span>
                  <span className="truncate">{h.source}</span>
                  {h.sentiment != null && (
                    <span
                      className={cn(
                        "ml-auto shrink-0 font-mono tabular-nums",
                        t === "positive" && "text-emerald-500",
                        t === "negative" && "text-red-500",
                      )}
                    >
                      {h.sentiment > 0 ? "+" : ""}
                      {h.sentiment.toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="text-sm leading-snug">
                  {h.url ? (
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-start gap-1 hover:underline"
                    >
                      {h.headline}
                      <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-50" />
                    </a>
                  ) : (
                    h.headline
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

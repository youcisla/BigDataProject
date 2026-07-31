"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { cn } from "@/lib/utils";

interface TableSpec {
  name: string;
  label: string;
  description: string;
  rows: number;
}

const PAGE_SIZE = 50;

/** Paginated, searchable browser over the Gold warehouse tables. */
export function GoldTableBrowser({ tables }: { tables: TableSpec[] }) {
  const [selected, setSelected] = useState(tables[0]?.name ?? "daily_prices");
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [appliedRange, setAppliedRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // `ticker` is the column a user actually wants to filter on across every
  // table here; falling back to it keeps the search box to one input.
  const filterColumn = "ticker";

  const load = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({
      name: selected,
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (applied) {
      params.set("column", filterColumn);
      params.set("q", applied);
    }
    if (appliedRange.from) params.set("from", appliedRange.from);
    if (appliedRange.to) params.set("to", appliedRange.to);
    fetch(`/api/table?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setColumns(j.columns ?? []);
        setRows(j.rows ?? []);
        setTotal(j.total ?? 0);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setRows([]);
          setColumns([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selected, page, applied, appliedRange]);

  useEffect(() => load(), [load]);

  const selectTable = (name: string) => {
    setSelected(name);
    setPage(0);
    setQuery("");
    setApplied("");
    setFrom("");
    setTo("");
    setAppliedRange({ from: "", to: "" });
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setApplied(query.trim());
    setAppliedRange({ from, to });
  };

  const spec = tables.find((t) => t.name === selected);
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const rowFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rowTo = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tables.map((t) => (
          <button
            key={t.name}
            onClick={() => selectTable(t.name)}
            aria-pressed={selected === t.name}
            className={cn(
              "rounded-md border px-3 py-1.5 text-left text-xs transition-all",
              selected === t.name
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <span className="font-medium">{t.label}</span>
            <span className={cn("ml-2 font-mono tabular-nums", selected === t.name ? "opacity-80" : "text-muted-foreground")}>
              {t.rows.toLocaleString()}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{spec?.description}</p>
        <form onSubmit={submitSearch} className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by ticker…"
              aria-label="Filter by ticker"
              className="w-48 rounded-md border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="From date"
              className="rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="To date"
              className="rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">Apply</Button>
          {(applied || appliedRange.from || appliedRange.to) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery(""); setFrom(""); setTo("");
                setApplied(""); setAppliedRange({ from: "", to: "" }); setPage(0);
              }}
            >
              Clear
            </Button>
          )}
        </form>
      </div>

      <div className="relative">
        {loading && (
          <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
            <Loader2 className="h-3 w-3 animate-spin" /> loading
          </div>
        )}
        <DataTable
          columns={columns}
          rows={rows}
          emptyMessage={applied ? `No rows matching "${applied}".` : "Table is empty — run the pipeline."}
          maxHeight={520}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">
          {rowFrom.toLocaleString()}–{rowTo.toLocaleString()} of {total.toLocaleString()} rows
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </Button>
          <span className="font-mono tabular-nums">
            {page + 1} / {lastPage + 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            disabled={page >= lastPage}
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

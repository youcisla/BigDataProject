"use client";

import { cn } from "@/lib/utils";

interface Props {
  columns: string[];
  rows: Record<string, unknown>[];
  /** Columns rendered right-aligned in a monospace face. */
  numeric?: string[];
  emptyMessage?: string;
  maxHeight?: number;
}

const NUMERIC_HINT = /^(open|high|low|close|volume|return_pct|volatility|rank|headline_count|sample_size|rows)$/;

const ISO_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(4);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") {
    // pg serialises DATE and TIMESTAMP columns as full ISO strings. A trading
    // date should read as a date, not as a UTC instant.
    const ts = ISO_TIMESTAMP.exec(value);
    if (ts) return ts[2] === "00:00" ? ts[1] : `${ts[1]} ${ts[2]}`;
    // Postgres NUMERIC arrives as a string; keep it readable without lying
    // about precision.
    if (/^-?\d+\.\d{5,}$/.test(value)) return parseFloat(value).toFixed(4);
    return value;
  }
  return String(value);
}

/**
 * Dense, scrollable table for raw pipeline records.
 *
 * The point of this project is the data, so the default is to show a lot of it:
 * small type, tight rows, sticky header, horizontal scroll rather than wrapping
 * or truncating columns away.
 */
export function DataTable({ columns, rows, numeric, emptyMessage = "No rows.", maxHeight = 460 }: Props) {
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed py-12 text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  const isNumeric = (col: string) => numeric?.includes(col) ?? NUMERIC_HINT.test(col);

  return (
    <div className="overflow-auto rounded-md border" style={{ maxHeight }}>
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm">
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                scope="col"
                className={cn(
                  "whitespace-nowrap border-b px-3 py-2 text-left font-medium text-muted-foreground",
                  isNumeric(col) && "text-right",
                )}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0 transition-colors hover:bg-accent/40">
              {columns.map((col) => {
                const raw = row[col];
                const text = renderCell(raw);
                return (
                  <td
                    key={col}
                    title={text.length > 40 ? text : undefined}
                    className={cn(
                      "px-3 py-1.5 align-top",
                      // Keep every row one line tall: long ids and headlines
                      // truncate with the full value on hover, rather than
                      // wrapping and destroying the scan-down rhythm.
                      isNumeric(col)
                        ? "whitespace-nowrap text-right font-mono tabular-nums"
                        : "max-w-[320px] truncate",
                      raw === null || raw === undefined ? "text-muted-foreground/50" : "",
                    )}
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

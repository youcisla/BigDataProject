"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, File as FileIcon, Folder, HardDrive, Loader2, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { cn } from "@/lib/utils";

interface HdfsEntry {
  name: string;
  path: string;
  type: "FILE" | "DIRECTORY";
  size: number;
  modified: number;
  owner: string;
  permission: string;
  childrenNum: number;
}

interface Summary {
  length: number;
  fileCount: number;
  directoryCount: number;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Live HDFS file browser with an inline preview for text files. */
export function HdfsBrowser({ root = "/data" }: { root?: string }) {
  const [path, setPath] = useState(root);
  const [entries, setEntries] = useState<HdfsEntry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback((target: string) => {
    setLoading(true);
    setError(null);
    fetch(`/api/hdfs?path=${encodeURIComponent(target)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setEntries(j.entries ?? []);
        setSummary(j.summary ?? null);
      })
      .catch((e) => {
        setError(String(e));
        setEntries([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(path);
    setPreviewPath(null);
    setPreview([]);
  }, [path, load]);

  const openFile = (entry: HdfsEntry) => {
    if (previewPath === entry.path) {
      setPreviewPath(null);
      setPreview([]);
      return;
    }
    setPreviewPath(entry.path);
    setPreviewLoading(true);
    fetch(`/api/hdfs?path=${encodeURIComponent(entry.path)}&preview=1&lines=25`)
      .then((r) => r.json())
      .then((j) => setPreview(j.lines ?? []))
      .catch(() => setPreview([]))
      .finally(() => setPreviewLoading(false));
  };

  // "/data/bronze/stocks" -> [/data, /data/bronze, /data/bronze/stocks]
  const crumbs = path.split("/").filter(Boolean);
  const crumbPaths = crumbs.map((_, i) => `/${crumbs.slice(0, i + 1).join("/")}`);

  const previewColumns = preview.length
    ? Array.from(new Set(preview.flatMap((r) => Object.keys(r))))
    : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
        <nav aria-label="HDFS path" className="flex flex-wrap items-center gap-1 text-sm">
          {crumbs.map((c, i) => (
            <span key={crumbPaths[i]} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <button
                onClick={() => setPath(crumbPaths[i])}
                disabled={i === crumbs.length - 1}
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono text-xs transition-colors",
                  i === crumbs.length - 1
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {c}
              </button>
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {summary && (
            <span className="font-mono text-xs text-muted-foreground">
              {summary.fileCount} files · {summary.directoryCount} dirs · {formatBytes(summary.length)}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={() => load(path)} aria-label="Refresh listing">
            <RefreshCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : loading && entries.length === 0 ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading HDFS…
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
          Empty directory. Run the pipeline to populate it.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/60">
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 text-left font-medium">Name</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Size</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Items</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Modified</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Perms</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.path}
                  className={cn(
                    "border-t transition-colors hover:bg-accent/40",
                    previewPath === e.path && "bg-accent/60",
                  )}
                >
                  <td className="px-3 py-2">
                    <button
                      onClick={() => (e.type === "DIRECTORY" ? setPath(e.path) : openFile(e))}
                      className="flex items-center gap-2 text-left hover:underline"
                    >
                      {e.type === "DIRECTORY" ? (
                        <Folder className="h-4 w-4 shrink-0 text-blue-500" />
                      ) : (
                        <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="font-mono text-xs">{e.name}</span>
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                    {e.type === "FILE" ? formatBytes(e.size) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {e.type === "DIRECTORY" ? e.childrenNum : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {e.modified ? new Date(e.modified).toISOString().slice(0, 16).replace("T", " ") : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{e.permission}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewPath && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileIcon className="h-3.5 w-3.5" />
            <span className="font-mono">{previewPath}</span>
            <span>— first {preview.length} records</span>
          </div>
          {previewLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading file…
            </div>
          ) : (
            <DataTable
              columns={previewColumns}
              rows={preview}
              emptyMessage="Could not read this file (binary, or Parquet — use the Silver tab)."
              maxHeight={320}
            />
          )}
        </div>
      )}
    </div>
  );
}

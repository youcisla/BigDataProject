"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Check, CloudUpload, Database, FileX2, Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DatasetInfo {
  name: string;
  path: string;
  sizeBytes: number;
  uploadedAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function DatasetsPanel() {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      const r = await fetch("/api/datasets");
      const j = (await r.json()) as { datasets: DatasetInfo[]; active: string | null; error?: string };
      setDatasets(j.datasets);
      setActive(j.active);
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const upload = async (file: File) => {
    setError(null);
    setUploading(true);
    setUploadProgress(0);

    return new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (ev) => {
        if (ev.lengthComputable) setUploadProgress((ev.loaded / ev.total) * 100);
      });
      xhr.addEventListener("load", () => {
        setUploading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          toast.success("Dataset uploaded", {
            description: "Saved to data/dumps/ and set as active.",
          });
          refresh();
          resolve();
        } else {
          setError(`Upload failed: ${xhr.status}`);
          toast.error("Upload failed", { description: `HTTP ${xhr.status}` });
          resolve();
        }
      });
      xhr.addEventListener("error", () => {
        setUploading(false);
        setError("Network error during upload");
        toast.error("Upload failed", { description: "Network error" });
        resolve();
      });
      const fd = new FormData();
      fd.append("file", file);
      xhr.open("POST", "/api/datasets");
      xhr.send(fd);
    });
  };

  const onSelectFile = (file: File | null) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024 * 1024) {
      setError("File exceeds 10 GB limit");
      toast.error("File too large", { description: "Max 10 GB" });
      return;
    }
    upload(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    onSelectFile(e.dataTransfer.files?.[0] ?? null);
  };

  const selectActive = async (name: string) => {
    const t = toast.loading("Selecting dataset...");
    try {
      const r = await fetch("/api/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "select", name }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success("Active dataset updated", { id: t });
      refresh();
    } catch (err) {
      toast.error("Select failed", { id: t, description: String(err) });
    }
  };

  const remove = async (name: string) => {
    if (!confirm(`Delete ${name}?`)) return;
    const t = toast.loading("Deleting...");
    try {
      await fetch("/api/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", name }),
      });
      toast.success("Deleted", { id: t });
      refresh();
    } catch (err) {
      toast.error("Delete failed", { id: t, description: String(err) });
    }
  };

  const activeName = active ? active.split(/[\\/]/).pop() : null;

  return (
    <Card className="bg-card/40 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" /> Datasets
        </CardTitle>
        <CardDescription>
          Upload a Reddit CSV/ZST dump. The active one is used by the Bulk pipeline step.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload zone */}
        <motion.div
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          whileHover={{ scale: 1.005 }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "relative rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/20",
            uploading && "pointer-events-none opacity-70"
          )}
        >
          <CloudUpload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <div className="text-sm font-medium">
            {dragOver ? "Drop to upload" : "Click or drag a CSV/ZST file to upload"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Max 10 GB. Saved to data/dumps/, marked active automatically.
          </div>
          {uploading && (
            <div className="mt-3 space-y-1">
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <motion.div
                  className="h-full bg-primary"
                  initial={{ width: "0%" }}
                  animate={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className="text-xs text-muted-foreground">{Math.round(uploadProgress)}%</div>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.zst,.tsv,.json,.jsonl"
            className="hidden"
            onChange={(e) => onSelectFile(e.target.files?.[0] ?? null)}
          />
        </motion.div>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Active callout */}
        {activeName && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 flex items-center gap-2"
          >
            <Star className="h-3.5 w-3.5 text-emerald-500 fill-emerald-500" />
            <span className="text-sm">
              <span className="font-medium">Active:</span> <code className="font-mono">{activeName}</code>
            </span>
          </motion.div>
        )}

        {/* Dataset list */}
        <AnimatePresence>
          {datasets.length > 0 ? (
            <div className="space-y-1.5">
              {datasets.map((d) => {
                const isActive = d.path === active;
                return (
                  <motion.div
                    key={d.name}
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      "flex items-center gap-3 rounded-md border p-2.5",
                      isActive && "bg-emerald-500/5 border-emerald-500/30"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono truncate">{d.name}</span>
                        {isActive && (
                          <Badge variant="success" className="text-xs">active</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatBytes(d.sizeBytes)} - {new Date(d.uploadedAt).toLocaleString()}
                      </div>
                    </div>
                    {!isActive && (
                      <Button variant="ghost" size="sm" onClick={() => selectActive(d.name)}>
                        <Check className="h-3 w-3" />
                        Use
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => remove(d.name)} title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">
              No datasets uploaded yet. Drop a file above to get started.
            </p>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

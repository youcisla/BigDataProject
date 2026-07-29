"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { formatDuration, formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";

export interface RunningJob {
  label: string;
  startedAt: number;
  records: number;
  lastId: string;
}

interface Props {
  job: RunningJob | null;
  onDismiss?: () => void;
}

export function RunningBanner({ job, onDismiss }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!job) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [job]);

  return (
    <AnimatePresence>
      {job && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="overflow-hidden border-b bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-blue-500/10 backdrop-blur-sm"
        >
          <div className="px-8 py-2.5 flex items-center gap-4">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            >
              <Loader2 className="h-4 w-4 text-blue-500" />
            </motion.div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-sm">{job.label}</span>
                <span className="text-xs text-muted-foreground">
                  running for {formatDuration(Date.now() - job.startedAt)}
                </span>
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  - started {formatRelative(job.startedAt)}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <Progress
                  value={job.records}
                  max={Math.max(job.records * 1.2, 1000)}
                  className="h-1 flex-1"
                />
                <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                  {job.records.toLocaleString()} rows
                </span>
              </div>
            </div>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Dismiss banner (job keeps running)"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

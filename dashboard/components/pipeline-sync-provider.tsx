"use client";

import { usePipelineSync } from "@/lib/pipeline-store";

/** Mounts the global polling loop. Place once near the root. */
export function PipelineSyncProvider({ children }: { children: React.ReactNode }) {
  usePipelineSync();
  return <>{children}</>;
}

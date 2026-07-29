"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "neutral" | "running";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-emerald-500 shadow-emerald-500/50",
  warning: "bg-amber-500 shadow-amber-500/50",
  danger: "bg-red-500 shadow-red-500/50",
  neutral: "bg-slate-500 shadow-slate-500/30",
  running: "bg-blue-500 shadow-blue-500/60",
};

export function PulseDot({ tone, className }: { tone: Tone; className?: string }) {
  const isPulsing = tone === "running" || tone === "warning";
  return (
    <span className={cn("relative inline-flex h-2.5 w-2.5", className)}>
      {isPulsing && (
        <motion.span
          className={cn("absolute inset-0 rounded-full opacity-75", TONE_CLASS[tone])}
          animate={{ scale: [1, 2.4], opacity: [0.6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full shadow-lg", TONE_CLASS[tone])} />
    </span>
  );
}

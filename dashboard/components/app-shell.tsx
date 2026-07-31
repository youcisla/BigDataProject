"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Database, Eye, GitBranch, HardDrive, Settings as SettingsIcon, Sparkles, TerminalSquare } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: Sparkles, href: "/#overview" },
  { id: "pipeline", label: "Pipeline", icon: GitBranch, href: "/#pipeline" },
  { id: "data", label: "Data explorer", icon: HardDrive, href: "/data" },
  { id: "analysis", label: "Analysis", icon: Eye, href: "/analysis" },
  { id: "logs", label: "Logs", icon: TerminalSquare, href: "/#logs" },
  { id: "settings", label: "Settings", icon: SettingsIcon, href: "/#settings" },
] as const;

/**
 * Sidebar shared by the routed pages. index.tsx keeps its own copy because its
 * nav drives in-page section state rather than navigation.
 */
export function AppShell({
  active,
  title,
  subtitle,
  actions,
  children,
}: {
  active: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[248px_1fr]">
        <aside className="sticky top-0 hidden h-screen flex-col border-r bg-card/30 backdrop-blur-sm lg:flex">
          <div className="border-b p-6">
            <Link href="/" className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/30">
                <Database className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-base font-semibold leading-tight">BigData Pipeline</h1>
                <p className="text-xs text-muted-foreground">Medallion dashboard</p>
              </div>
            </Link>
          </div>

          <nav className="flex-1 space-y-1 p-3">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                aria-current={item.id === active ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all",
                  item.id === active
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="border-t p-3">
            <ThemeToggle />
          </div>
        </aside>

        <div className="min-w-0 overflow-auto">
          <motion.header
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="sticky top-0 z-20 border-b bg-background/80 px-6 py-4 backdrop-blur-md lg:px-8"
          >
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-0">
                <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
                {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
              </div>
              <div className="ml-auto flex items-center gap-2">{actions}</div>
            </div>
          </motion.header>

          <div className="px-6 py-6 lg:px-8">{children}</div>
        </div>
      </div>
    </main>
  );
}

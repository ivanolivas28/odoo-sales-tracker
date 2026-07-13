"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { TaskCard, type TaskItem, type GeneratedContent } from "@/components/tasks/TaskCard";

const FILTERS: { key: TaskItem["type"] | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "urgent_call", label: "Urgent" },
  { key: "hot_followup", label: "Hot" },
  { key: "prospecting", label: "Prospecting" },
  { key: "reactivation", label: "Reactivation" },
];

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskItem["type"] | "all">("all");
  const [results, setResults] = useState<Record<string, GeneratedContent>>({});
  const [googleStatus, setGoogleStatus] = useState<{
    connected: boolean;
    spreadsheetUrl?: string;
    contactsSheetUrl?: string;
    ordersSheetUrl?: string;
    quotationsSheetUrl?: string;
  } | null>(null);

  const loadGoogleStatus = useCallback(() => {
    return fetch("/api/google/status")
      .then((res) => res.json())
      .then(setGoogleStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadGoogleStatus();

    const params = new URLSearchParams(window.location.search);
    const google = params.get("google");
    if (google === "connected") {
      toast.success("Google connected");
      window.history.replaceState({}, "", "/");
    } else if (google === "error") {
      toast.error(params.get("message") || "Google connection failed");
      window.history.replaceState({}, "", "/");
    }
  }, [loadGoogleStatus]);

  const loadTasks = useCallback(() => {
    return fetch("/api/tasks")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load tasks");
        setTasks(body.tasks as TaskItem[]);
        setError(null);
      })
      .catch((err: Error) => {
        setError(err.message);
        toast.error(err.message);
      });
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Sync failed");
      toast.success(
        body.sheetUrl
          ? `Synced — ${body.created} new, ${body.updated} updated. Sheet updated.`
          : `Synced — ${body.created} new, ${body.updated} updated`
      );
      await loadTasks();
      await loadGoogleStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tasks?.length ?? 0 };
    for (const t of tasks ?? []) c[t.type] = (c[t.type] ?? 0) + 1;
    return c;
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    if (!tasks) return tasks;
    return filter === "all" ? tasks : tasks.filter((t) => t.type === filter);
  }, [tasks, filter]);

  async function handleComplete(id: string) {
    setCompletingId(id);
    try {
      const res = await fetch(`/api/tasks/${id}/complete`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to complete task");
      toast.success("Logged in Odoo");
      setResults((prev) => ({ ...prev, [id]: body.task.generatedContent as GeneratedContent }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to complete task");
    } finally {
      setCompletingId(null);
    }
  }

  function handleDismiss(id: string) {
    setTasks((prev) => (prev ? prev.filter((t) => t._id !== id) : prev));
    setResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  return (
    <div className="min-h-full w-full bg-[var(--background)] px-6 py-10 sm:px-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--ink-primary)]">Today&apos;s tasks</h1>
            <p className="text-sm text-[var(--ink-muted)]">
              Generated from Odoo — customers, quotations, and leads
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {googleStatus?.connected ? (
              (() => {
                const sheetLinks = [
                  { url: googleStatus.contactsSheetUrl, label: "Contactos" },
                  { url: googleStatus.ordersSheetUrl, label: "Órdenes" },
                  { url: googleStatus.quotationsSheetUrl, label: "Cotizaciones" },
                  { url: googleStatus.spreadsheetUrl, label: "Leads" },
                ].filter((l): l is { url: string; label: string } => !!l.url);

                return sheetLinks.length > 0 ? (
                  <>
                    {sheetLinks.map((l) => (
                      <a
                        key={l.label}
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-[var(--border-hairline)] px-4 py-1.5 text-sm font-medium text-[var(--ink-primary)] hover:bg-[var(--grid-line)]"
                      >
                        {l.label}
                      </a>
                    ))}
                  </>
                ) : (
                  <span className="text-xs text-[var(--ink-muted)]">Google connected — sheets appear after next sync</span>
                );
              })()
            ) : (
              <a
                href="/api/google/connect"
                className="rounded-full border border-[var(--border-hairline)] px-4 py-1.5 text-sm font-medium text-[var(--ink-primary)] hover:bg-[var(--grid-line)]"
              >
                Connect Google
              </a>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="rounded-full border border-[var(--border-hairline)] px-4 py-1.5 text-sm font-medium text-[var(--ink-primary)] transition-opacity disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-[var(--status-critical)] bg-[var(--chart-surface)] p-4 text-sm text-[var(--status-critical)]">
            Couldn&apos;t load tasks: {error}
          </div>
        )}

        {!tasks && !error && <p className="text-sm text-[var(--ink-muted)]">Loading tasks…</p>}

        {tasks && tasks.length === 0 && (
          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--chart-surface)] p-8 text-center">
            <p className="font-medium text-[var(--ink-primary)]">All caught up</p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              No pending tasks. Hit &quot;Sync now&quot; to pull the latest from Odoo.
            </p>
          </div>
        )}

        {tasks && tasks.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                    filter === f.key
                      ? "bg-[var(--series-blue)] text-white"
                      : "border border-[var(--border-hairline)] text-[var(--ink-secondary)] hover:bg-[var(--grid-line)]"
                  }`}
                >
                  {f.label} ({counts[f.key] ?? 0})
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-3">
              {visibleTasks?.map((task) => (
                <TaskCard
                  key={task._id}
                  task={task}
                  onComplete={handleComplete}
                  pending={completingId === task._id}
                  result={results[task._id]}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

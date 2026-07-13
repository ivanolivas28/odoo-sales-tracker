"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/salesAggregates";

export interface TaskItem {
  _id: string;
  type: "urgent_call" | "hot_followup" | "prospecting" | "reactivation";
  partnerName: string;
  reason: string;
  amount?: number;
  createdAt: string;
}

export interface GeneratedContent {
  channel: "whatsapp" | "email" | "no_phone";
  subject?: string;
  message?: string;
  phone?: string;
  email?: string;
  waLink?: string;
}

const TYPE_META: Record<
  TaskItem["type"],
  { label: string; action: string; color: string }
> = {
  urgent_call: { label: "Urgent", action: "Call", color: "var(--status-critical)" },
  hot_followup: { label: "Hot", action: "Follow up", color: "var(--status-warning)" },
  prospecting: { label: "Prospecting", action: "Email", color: "var(--series-blue)" },
  reactivation: { label: "Reactivation", action: "Email", color: "#4a3aa7" },
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-full border border-[var(--border-hairline)] px-3 py-1 text-xs font-medium text-[var(--ink-secondary)] hover:bg-[var(--grid-line)]"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

interface TaskCardProps {
  task: TaskItem;
  onComplete: (id: string) => void;
  pending: boolean;
  result?: GeneratedContent;
  onDismiss: (id: string) => void;
}

export function TaskCard({ task, onComplete, pending, result, onDismiss }: TaskCardProps) {
  const meta = TYPE_META[task.type];

  return (
    <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--chart-surface)] p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: meta.color }}
            />
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
              {meta.label}
            </span>
          </div>
          <p className="mt-1 truncate font-medium text-[var(--ink-primary)]">{task.partnerName}</p>
          <p className="mt-0.5 text-sm text-[var(--ink-secondary)]">{task.reason}</p>
        </div>

        {!result && (
          <div className="flex shrink-0 flex-col items-end gap-2">
            {task.amount !== undefined && (
              <span className="text-sm font-medium tabular-nums text-[var(--ink-primary)]">
                {formatCurrency(task.amount)}
              </span>
            )}
            <button
              onClick={() => onComplete(task._id)}
              disabled={pending}
              className="rounded-full bg-[var(--series-blue)] px-4 py-1.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? "Saving…" : meta.action}
            </button>
          </div>
        )}
      </div>

      {result && (
        <div className="mt-3 rounded-lg bg-[var(--grid-line)] p-3">
          {result.channel === "whatsapp" && result.message && (
            <>
              <p className="whitespace-pre-wrap text-sm text-[var(--ink-primary)]">{result.message}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                  href={result.waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full bg-[#25D366] px-4 py-1.5 text-sm font-medium text-white"
                >
                  Open WhatsApp
                </a>
                <CopyButton text={result.message} label="Copy message" />
                <button
                  onClick={() => onDismiss(task._id)}
                  className="ml-auto text-xs text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
                >
                  Close
                </button>
              </div>
            </>
          )}

          {result.channel === "email" && result.message && (
            <>
              <p className="text-xs text-[var(--ink-muted)]">To</p>
              <div className="flex items-center gap-2">
                <p className="text-sm text-[var(--ink-primary)]">{result.email || "No email on file"}</p>
                {result.email && <CopyButton text={result.email} label="Copy" />}
              </div>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">Subject</p>
              <div className="flex items-center gap-2">
                <p className="text-sm text-[var(--ink-primary)]">{result.subject}</p>
                {result.subject && <CopyButton text={result.subject} label="Copy" />}
              </div>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">Body</p>
              <p className="whitespace-pre-wrap text-sm text-[var(--ink-primary)]">{result.message}</p>
              <div className="mt-3 flex items-center gap-2">
                <CopyButton text={result.message} label="Copy body" />
                <button
                  onClick={() => onDismiss(task._id)}
                  className="ml-auto text-xs text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
                >
                  Close
                </button>
              </div>
            </>
          )}

          {result.channel === "no_phone" && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-[var(--ink-secondary)]">
                No phone on file — logged in Odoo for manual contact.
              </p>
              <button
                onClick={() => onDismiss(task._id)}
                className="shrink-0 text-xs text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
              >
                Close
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

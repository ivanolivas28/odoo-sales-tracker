"use client";

import { useState } from "react";
import type { DayRevenue } from "@/lib/salesAggregates";
import { formatCurrency } from "@/lib/salesAggregates";

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function RevenueChart({ data }: { data: DayRevenue[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.total), 1));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);

  return (
    <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--chart-surface)] p-5">
      <p className="text-sm font-medium text-[var(--ink-primary)]">Revenue by day</p>
      <p className="text-xs text-[var(--ink-muted)]">Last {data.length} days</p>

      <div className="relative mt-6 flex h-56">
        <div className="flex flex-col justify-between pr-3 text-right text-xs text-[var(--ink-muted)]">
          {[...ticks].reverse().map((t) => (
            <span key={t}>{formatCurrency(t)}</span>
          ))}
        </div>

        <div className="relative flex flex-1 items-end gap-[2px]">
          {ticks.map((t) => (
            <div
              key={t}
              className="pointer-events-none absolute left-0 right-0 border-t border-[var(--grid-line)]"
              style={{ bottom: `${(t / max) * 100}%` }}
            />
          ))}

          {data.map((d, i) => (
            <div
              key={d.date}
              className="group relative flex flex-1 items-end justify-center self-stretch"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <div
                className="w-full max-w-[24px] rounded-t-[4px] bg-[var(--series-blue)] transition-opacity group-hover:opacity-80"
                style={{ height: `${(d.total / max) * 100}%`, minHeight: d.total > 0 ? 2 : 0 }}
              />
              {hovered === i && (
                <div className="pointer-events-none absolute bottom-full mb-2 whitespace-nowrap rounded-md border border-[var(--border-hairline)] bg-[var(--chart-surface)] px-2 py-1 text-xs shadow-sm">
                  <span className="text-[var(--ink-secondary)]">{d.label}</span>{" "}
                  <span className="font-medium text-[var(--ink-primary)]">
                    {formatCurrency(d.total)}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex gap-[2px] pl-10 text-[10px] text-[var(--ink-muted)]">
        {data.map((d, i) => (
          <span key={d.date} className="flex-1 text-center">
            {i % Math.ceil(data.length / 7) === 0 ? d.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

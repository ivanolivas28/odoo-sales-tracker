import type { CustomerRevenue } from "@/lib/salesAggregates";
import { formatCurrency } from "@/lib/salesAggregates";

export function TopCustomers({ data }: { data: CustomerRevenue[] }) {
  const max = Math.max(...data.map((d) => d.total), 1);

  return (
    <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--chart-surface)] p-5">
      <p className="text-sm font-medium text-[var(--ink-primary)]">Top customers</p>
      <p className="text-xs text-[var(--ink-muted)]">By revenue, current orders</p>

      <div className="mt-5 flex flex-col gap-3">
        {data.length === 0 && <p className="text-sm text-[var(--ink-muted)]">No data yet</p>}
        {data.map((c) => (
          <div key={c.name}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-[var(--ink-secondary)]">{c.name}</span>
              <span className="shrink-0 font-medium text-[var(--ink-primary)]">
                {formatCurrency(c.total)}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-[var(--grid-line)]">
              <div
                className="h-2 rounded-full bg-[var(--series-blue)]"
                style={{ width: `${(c.total / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

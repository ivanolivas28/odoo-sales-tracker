interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
}

export function StatTile({ label, value, sub }: StatTileProps) {
  return (
    <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--chart-surface)] p-5">
      <p className="text-sm text-[var(--ink-secondary)]">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-[var(--ink-primary)]">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--ink-muted)]">{sub}</p>}
    </div>
  );
}

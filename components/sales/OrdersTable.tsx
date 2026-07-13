import type { SaleOrder } from "@/lib/types";
import { formatCurrency } from "@/lib/salesAggregates";

const STATE_LABEL: Record<string, string> = {
  sale: "Confirmed",
  done: "Locked",
};

export function OrdersTable({ orders }: { orders: SaleOrder[] }) {
  return (
    <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--chart-surface)] p-5">
      <p className="text-sm font-medium text-[var(--ink-primary)]">Recent orders</p>
      <p className="text-xs text-[var(--ink-muted)]">Most recent {orders.length} confirmed orders</p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--grid-line)] text-left text-xs text-[var(--ink-muted)]">
              <th className="pb-2 pr-4 font-medium">Order</th>
              <th className="pb-2 pr-4 font-medium">Customer</th>
              <th className="pb-2 pr-4 font-medium">Salesperson</th>
              <th className="pb-2 pr-4 font-medium">Date</th>
              <th className="pb-2 pr-4 font-medium">Status</th>
              <th className="pb-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.slice(0, 20).map((o) => (
              <tr key={o.id} className="border-b border-[var(--grid-line)] last:border-0">
                <td className="py-2 pr-4 text-[var(--ink-primary)]">{o.name}</td>
                <td className="py-2 pr-4 text-[var(--ink-secondary)]">
                  {o.partner_id ? o.partner_id[1] : "—"}
                </td>
                <td className="py-2 pr-4 text-[var(--ink-secondary)]">
                  {o.user_id ? o.user_id[1] : "—"}
                </td>
                <td className="py-2 pr-4 tabular-nums text-[var(--ink-secondary)]">
                  {o.date_order.slice(0, 10)}
                </td>
                <td className="py-2 pr-4">
                  <span className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-secondary)]">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: "var(--status-good)" }}
                    />
                    {STATE_LABEL[o.state] ?? o.state}
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums font-medium text-[var(--ink-primary)]">
                  {formatCurrency(o.amount_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 && (
          <p className="py-6 text-center text-sm text-[var(--ink-muted)]">No orders found</p>
        )}
      </div>
    </div>
  );
}

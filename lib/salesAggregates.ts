import type { SaleOrder } from "@/lib/types";

export interface DayRevenue {
  date: string;
  label: string;
  total: number;
}

export interface CustomerRevenue {
  name: string;
  total: number;
}

export function sumRevenue(orders: SaleOrder[]): number {
  return orders.reduce((sum, o) => sum + o.amount_total, 0);
}

export function revenueByDay(orders: SaleOrder[], days: number): DayRevenue[] {
  const totals = new Map<string, number>();
  for (const order of orders) {
    const day = order.date_order.slice(0, 10);
    totals.set(day, (totals.get(day) ?? 0) + order.amount_total);
  }

  const result: DayRevenue[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({
      date: key,
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      total: totals.get(key) ?? 0,
    });
  }
  return result;
}

export function topCustomers(orders: SaleOrder[], limit: number): CustomerRevenue[] {
  const totals = new Map<string, number>();
  for (const order of orders) {
    if (!order.partner_id) continue;
    const name = order.partner_id[1];
    totals.set(name, (totals.get(name) ?? 0) + order.amount_total);
  }

  return [...totals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { SaleOrder } from "@/lib/types";
import { formatCurrency, revenueByDay, sumRevenue, topCustomers } from "@/lib/salesAggregates";
import { StatTile } from "@/components/sales/StatTile";
import { RevenueChart } from "@/components/sales/RevenueChart";
import { TopCustomers } from "@/components/sales/TopCustomers";
import { OrdersTable } from "@/components/sales/OrdersTable";

export default function DashboardPage() {
  const [orders, setOrders] = useState<SaleOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/sales")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load sales data");
        if (!cancelled) setOrders(body.orders as SaleOrder[]);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        toast.error(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-full w-full bg-[var(--background)] px-6 py-10 sm:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold text-[var(--ink-primary)]">Sales Dashboard</h1>
          <p className="text-sm text-[var(--ink-muted)]">Live from Odoo</p>
        </header>

        {error && (
          <div className="rounded-xl border border-[var(--status-critical)] bg-[var(--chart-surface)] p-4 text-sm text-[var(--status-critical)]">
            Couldn&apos;t load sales data: {error}
          </div>
        )}

        {!orders && !error && (
          <p className="text-sm text-[var(--ink-muted)]">Loading sales data…</p>
        )}

        {orders && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile label="Total revenue" value={formatCurrency(sumRevenue(orders))} sub={`${orders.length} confirmed orders`} />
              <StatTile label="Orders" value={orders.length.toString()} />
              <StatTile
                label="Average order value"
                value={formatCurrency(orders.length ? sumRevenue(orders) / orders.length : 0)}
              />
            </div>

            <RevenueChart data={revenueByDay(orders, 14)} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
              <TopCustomers data={topCustomers(orders, 5)} />
              <OrdersTable orders={orders} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

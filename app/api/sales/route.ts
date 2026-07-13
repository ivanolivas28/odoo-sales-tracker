import { NextResponse } from "next/server";
import { executeKw } from "@/lib/odoo";
import type { SaleOrder } from "@/lib/types";

export async function GET() {
  try {
    const orders = await executeKw<SaleOrder[]>(
      "sale.order",
      "search_read",
      [[["state", "in", ["sale", "done"]]]],
      {
        fields: ["name", "partner_id", "user_id", "amount_total", "state", "date_order"],
        order: "date_order desc",
        limit: 200,
      }
    );

    return NextResponse.json({ orders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch sales data from Odoo";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

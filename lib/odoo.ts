import axios from "axios";

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_USER = process.env.ODOO_USER;
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: { message?: string } };
}

async function jsonRpc<T>(service: string, method: string, args: unknown[]): Promise<T> {
  if (!ODOO_URL) throw new Error("ODOO_URL is not configured");

  const { data } = await axios.post<JsonRpcResponse<T>>(`${ODOO_URL}/jsonrpc`, {
    jsonrpc: "2.0",
    method: "call",
    params: { service, method, args },
    id: Math.floor(Math.random() * 1_000_000),
  });

  if (data.error) {
    throw new Error(data.error.data?.message ?? data.error.message);
  }
  if (data.result === undefined) {
    throw new Error("Odoo returned an empty response");
  }
  return data.result;
}

let cachedUid: number | null = null;

async function getUid(): Promise<number> {
  if (cachedUid !== null) return cachedUid;
  if (!ODOO_DB || !ODOO_USER || !ODOO_PASSWORD) {
    throw new Error("ODOO_DB, ODOO_USER, and ODOO_PASSWORD must be configured");
  }

  const uid = await jsonRpc<number | false>("common", "authenticate", [
    ODOO_DB,
    ODOO_USER,
    ODOO_PASSWORD,
    {},
  ]);

  if (!uid) throw new Error("Odoo authentication failed — check ODOO_USER/ODOO_PASSWORD");
  cachedUid = uid;
  return uid;
}

export async function executeKw<T>(
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {}
): Promise<T> {
  const uid = await getUid();
  return jsonRpc<T>("object", "execute_kw", [
    ODOO_DB,
    uid,
    ODOO_PASSWORD,
    model,
    method,
    args,
    kwargs,
  ]);
}

// ========== Sales Tracker Functions ==========

export interface OdooContact {
  id: number;
  name: string;
  email?: string | false;
  phone?: string | false;
  mobile?: string | false;
  city?: string | false;
  function?: string | false;
  industry_id?: [number, string] | false;
  customer_rank?: number;
  supplier_rank?: number;
  create_date?: string;
}

export interface OdooSalesOrder {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  date_order: string;
  create_date: string;
  amount_total: number;
  currency_id?: [number, string] | false;
  state: string;
  user_id?: [number, string] | false;
  company_id?: [number, string] | false;
  invoice_status?: string | false;
  /** Dynamic date/datetime fields discovered via fields_get. */
  [key: string]: unknown;
}

/** Fetch ALL contacts from the Contacts module (type = contact) */
export async function fetchAllContacts(limit = 500, offset = 0): Promise<OdooContact[]> {
  return executeKw<OdooContact[]>(
    "res.partner",
    "search_read",
    [[["type", "=", "contact"]]],
    {
      fields: [
        "id",
        "name",
        "email",
        "phone",
        "mobile",
        "city",
        "function",
        "industry_id",
        "customer_rank",
        "supplier_rank",
        "create_date",
      ],
      limit,
      offset,
      order: "create_date DESC",
    }
  );
}

/** Paginate through all contacts */
export async function fetchAllContactsPaginated(): Promise<OdooContact[]> {
  let allContacts: OdooContact[] = [];
  let offset = 0;
  const limit = 500;
  let hasMore = true;

  while (hasMore) {
    const batch = await fetchAllContacts(limit, offset);
    if (!batch || batch.length === 0) {
      hasMore = false;
    } else {
      allContacts = allContacts.concat(batch);
      offset += limit;
    }
  }

  return allContacts;
}

export interface OdooOrderLine {
  id: number;
  order_id: [number, string] | false;
  product_id: [number, string] | false;
  name: string;
  product_uom_qty: number;
  price_unit: number;
  discount: number;
  price_subtotal: number;
  price_total: number;
  /** 'line_section' | 'line_note' for section/note rows, false for real products. */
  display_type: string | false;
}

/** Fetch the product lines of the given sale orders/quotations. */
export async function fetchOrderLines(orderIds: number[]): Promise<OdooOrderLine[]> {
  const all: OdooOrderLine[] = [];

  // Chunk the ids so the domain stays a reasonable size.
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = orderIds.slice(i, i + 500);
    const lines = await executeKw<OdooOrderLine[]>(
      "sale.order.line",
      "search_read",
      [[["order_id", "in", chunk]]],
      {
        fields: [
          "id",
          "order_id",
          "product_id",
          "name",
          "product_uom_qty",
          "price_unit",
          "discount",
          "price_subtotal",
          "price_total",
          "display_type",
        ],
        order: "order_id DESC, id ASC",
        limit: 100000,
      }
    );
    all.push(...lines);
  }

  return all;
}

export interface OdooDateField {
  name: string;
  label: string;
}

/**
 * Ask Odoo which date/datetime fields exist on sale.order (fields_get is the
 * official model-introspection API), so the sheet can include every date the
 * sales module tracks regardless of Odoo version or installed modules.
 */
export async function fetchSaleOrderDateFields(): Promise<OdooDateField[]> {
  const fields = await executeKw<Record<string, { string?: string; type?: string }>>(
    "sale.order",
    "fields_get",
    [],
    { attributes: ["string", "type"] }
  );

  return Object.entries(fields)
    .filter(
      ([name, meta]) =>
        name.toLowerCase().includes("date") && (meta.type === "date" || meta.type === "datetime")
    )
    .map(([name, meta]) => ({ name, label: meta.string || name }));
}

/** Fetch sales orders and quotations above USD 1000 threshold */
export async function fetchSalesOrdersAboveThreshold(minUSD = 1000): Promise<{
  confirmedOrders: OdooSalesOrder[];
  quotations: OdooSalesOrder[];
  dateFields: OdooDateField[];
}> {
  // For simplicity, we'll use minUSD directly as threshold
  // In production, you'd convert MXN to USD using currency rates from Odoo

  const dateFields = await fetchSaleOrderDateFields();

  const BASE_FIELDS = [
    "id",
    "name",
    "partner_id",
    "amount_total",
    "currency_id",
    "state",
    "user_id",
    "company_id",
    "invoice_status",
  ];
  const ORDER_FIELDS = [...new Set([...BASE_FIELDS, ...dateFields.map((f) => f.name)])];

  const [confirmedOrders, quotations] = await Promise.all([
    executeKw<OdooSalesOrder[]>(
      "sale.order",
      "search_read",
      [[["state", "in", ["sale", "done"]], ["amount_total", ">=", minUSD]]],
      { fields: ORDER_FIELDS, order: "create_date DESC", limit: 10000 }
    ),
    executeKw<OdooSalesOrder[]>(
      "sale.order",
      "search_read",
      [[["state", "in", ["draft", "sent"]], ["amount_total", ">=", minUSD]]],
      { fields: ORDER_FIELDS, order: "create_date DESC", limit: 10000 }
    ),
  ]);

  return {
    confirmedOrders: confirmedOrders || [],
    quotations: quotations || [],
    dateFields,
  };
}

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
  email?: string;
  phone?: string;
  mobile?: string;
  city?: string;
  industry_id?: [number, string];
  customer_rank?: number;
  supplier_rank?: number;
  create_date?: string;
  write_date?: string;
}

export interface OdooSalesOrder {
  id: number;
  name: string;
  partner_id: [number, string];
  date_order: string;
  amount_total: number;
  amount_untaxed: number;
  currency_id?: [number, string];
  state: string;
  validity_date?: string;
  create_date: string;
  write_date: string;
  user_id?: [number, string];
  company_id?: [number, string];
}

/** Fetch ALL contacts from the Contacts module (type = contact) */
export async function fetchAllContacts(limit = 500, offset = 0): Promise<OdooContact[]> {
  return executeKw<OdooContact[]>("res.partner", "search_read", [
    [["type", "=", "contact"]],
    {
      fields: [
        "id",
        "name",
        "email",
        "phone",
        "mobile",
        "city",
        "industry_id",
        "customer_rank",
        "supplier_rank",
        "create_date",
        "write_date",
      ],
      limit,
      offset,
      order: "write_date DESC",
    },
  ]);
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

/** Fetch sales orders and quotations above USD 1000 threshold */
export async function fetchSalesOrdersAboveThreshold(
  minUSD = 1000
): Promise<{ confirmedOrders: OdooSalesOrder[]; quotations: OdooSalesOrder[] }> {
  // For simplicity, we'll use minUSD directly as threshold
  // In production, you'd convert MXN to USD using currency rates from Odoo

  const [confirmedOrders, quotations] = await Promise.all([
    executeKw<OdooSalesOrder[]>("sale.order", "search_read", [
      [["state", "in", ["sale", "done"]], ["amount_total", ">=", minUSD]],
      {
        fields: [
          "id",
          "name",
          "partner_id",
          "date_order",
          "amount_total",
          "amount_untaxed",
          "currency_id",
          "state",
          "validity_date",
          "create_date",
          "write_date",
          "user_id",
          "company_id",
        ],
        order: "date_order DESC",
        limit: 10000,
      },
    ]),
    executeKw<OdooSalesOrder[]>("sale.order", "search_read", [
      [["state", "=", "draft"], ["amount_total", ">=", minUSD]],
      {
        fields: [
          "id",
          "name",
          "partner_id",
          "date_order",
          "amount_total",
          "amount_untaxed",
          "currency_id",
          "state",
          "validity_date",
          "create_date",
          "write_date",
          "user_id",
          "company_id",
        ],
        order: "write_date DESC",
        limit: 10000,
      },
    ]),
  ]);

  return {
    confirmedOrders: confirmedOrders || [],
    quotations: quotations || [],
  };
}

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

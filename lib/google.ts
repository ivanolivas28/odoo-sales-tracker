import { google } from "googleapis";
import { connectMongo } from "@/lib/mongodb";
import { Settings } from "@/models/Settings";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const REDIRECT_PATH = "/api/auth/callback/google";

function redirectUri(): string {
  const base = process.env.NEXTAUTH_URL || "http://localhost:3001";
  return `${base}${REDIRECT_PATH}`;
}

function oauthClient() {
  return new google.auth.OAuth2(process.env.GOOGLE_ID, process.env.GOOGLE_SECRET, redirectUri());
}

export function buildGoogleAuthUrl(): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

export async function handleGoogleCallback(code: string): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token — revoke prior access at myaccount.google.com/permissions and try again");
  }

  await connectMongo();
  await Settings.findOneAndUpdate(
    { key: "google" },
    { key: "google", googleRefreshToken: tokens.refresh_token },
    { upsert: true }
  );
}

export async function isGoogleConnected(): Promise<boolean> {
  await connectMongo();
  const settings = await Settings.findOne({ key: "google" });
  return !!settings?.googleRefreshToken;
}

function sheetUrl(id?: string): string | undefined {
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : undefined;
}

export async function getGoogleStatus(): Promise<{
  connected: boolean;
  spreadsheetUrl?: string;
  contactsSheetUrl?: string;
  ordersSheetUrl?: string;
  quotationsSheetUrl?: string;
}> {
  await connectMongo();
  const settings = await Settings.findOne({ key: "google" });
  return {
    connected: !!settings?.googleRefreshToken,
    spreadsheetUrl: sheetUrl(settings?.spreadsheetId),
    contactsSheetUrl: sheetUrl(settings?.contactsSheetId),
    ordersSheetUrl: sheetUrl(settings?.ordersSheetId),
    quotationsSheetUrl: sheetUrl(settings?.quotationsSheetId),
  };
}

async function getAuthedClient() {
  await connectMongo();
  const settings = await Settings.findOne({ key: "google" });
  if (!settings?.googleRefreshToken) throw new Error("Google account not connected");
  const client = oauthClient();
  client.setCredentials({ refresh_token: settings.googleRefreshToken });
  return client;
}

const HEADER = ["Tipo", "Empresa / Contacto", "Correo", "WhatsApp", "Motivo", "Monto (MXN)", "Fecha del registro en Odoo"];

/** Creates the leads spreadsheet on first run, then overwrites its contents on every subsequent sync. */
export async function syncLeadsSheet(rows: string[][]): Promise<string> {
  const auth = await getAuthedClient();
  const sheets = google.sheets({ version: "v4", auth });

  await connectMongo();
  const settings = await Settings.findOne({ key: "google" });
  let spreadsheetId = settings?.spreadsheetId;

  // The stored ID may point to a sheet the user deleted from Drive.
  if (spreadsheetId) {
    try {
      await sheets.spreadsheets.get({ spreadsheetId });
    } catch {
      spreadsheetId = undefined;
    }
  }

  if (!spreadsheetId) {
    const created = await sheets.spreadsheets.create({
      requestBody: { properties: { title: "Sales Tracker - Leads" } },
    });
    spreadsheetId = created.data.spreadsheetId ?? undefined;
    if (!spreadsheetId) throw new Error("Google did not return a spreadsheet id");
    await Settings.findOneAndUpdate({ key: "google" }, { spreadsheetId });
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: "A1:Z10000" });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "A1",
    valueInputOption: "RAW",
    requestBody: { values: [HEADER, ...rows] },
  });

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

// ========== Analysis Sheet Functions ==========

import type { OdooContact, OdooSalesOrder, OdooDateField, OdooOrderLine } from "@/lib/odoo";

// Claude Cowork's Drive connector only reads the first tab of a spreadsheet,
// so each dataset lives in its own file instead of tabs of a single one.
type AnalysisSheetField = "contactsSheetId" | "ordersSheetId" | "quotationsSheetId";

const ANALYSIS_FILES: Record<AnalysisSheetField, string> = {
  contactsSheetId: "Odoo - Contactos",
  ordersSheetId: "Odoo - Órdenes",
  quotationsSheetId: "Odoo - Cotizaciones",
};

/** Get the stored spreadsheet for a dataset, recreating it if it was deleted from Drive. */
async function ensureAnalysisFile(field: AnalysisSheetField): Promise<string> {
  const auth = await getAuthedClient();
  const sheets = google.sheets({ version: "v4", auth });

  await connectMongo();
  const settings = await Settings.findOne({ key: "google" });
  let spreadsheetId: string | undefined = settings?.[field];

  if (spreadsheetId) {
    try {
      await sheets.spreadsheets.get({ spreadsheetId });
    } catch {
      spreadsheetId = undefined;
    }
  }

  if (!spreadsheetId) {
    const created = await sheets.spreadsheets.create({
      requestBody: { properties: { title: ANALYSIS_FILES[field] } },
    });
    spreadsheetId = created.data.spreadsheetId ?? undefined;
    if (!spreadsheetId) throw new Error("Google did not return a spreadsheet id");
    await Settings.findOneAndUpdate({ key: "google" }, { [field]: spreadsheetId });
    console.log(`[SYNC] Created spreadsheet "${ANALYSIS_FILES[field]}"`);
  }

  return spreadsheetId;
}

/** Overwrite the first tab of the dataset's spreadsheet with the given rows. */
async function writeAnalysisFile(field: AnalysisSheetField, values: string[][]): Promise<string> {
  const spreadsheetId = await ensureAnalysisFile(field);
  const auth = await getAuthedClient();
  const sheets = google.sheets({ version: "v4", auth });

  // Ranges without a tab prefix target the first (and only) tab.
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: "A1:ZZ100000" });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "A1",
    valueInputOption: "RAW",
    requestBody: { values },
  });

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

/** Write contacts to their own spreadsheet */
export async function writeContactsToAnalysisSheet(contacts: OdooContact[]): Promise<string | undefined> {
  if (!contacts || contacts.length === 0) return undefined;

  const headers = [
    "ID",
    "Nombre",
    "Email",
    "Teléfono",
    "Móvil",
    "Ciudad",
    "Puesto",
    "Industria",
    "¿Es Cliente?",
    "Fecha de Creación",
  ];

  const rows = contacts.map((c) => [
    String(c.id || ""),
    c.name || "",
    c.email || "",
    c.phone || "",
    c.mobile || "",
    c.city || "",
    c.function || "",
    Array.isArray(c.industry_id) ? c.industry_id[1] : "",
    c.customer_rank && c.customer_rank > 0 ? "Sí" : "No",
    formatOdooDatetime(c.create_date),
  ]);

  return writeAnalysisFile("contactsSheetId", [headers, ...rows]);
}

// Odoo stores datetimes in UTC; its own exports convert them to the user's
// timezone. Do the same so the sheet matches what the user sees in Odoo.
const ODOO_TIMEZONE = process.env.ODOO_TIMEZONE || "America/Mexico_City";

export function formatOdooDatetime(utcDatetime?: string | false): string {
  if (!utcDatetime) return "";
  const date = new Date(String(utcDatetime).replace(" ", "T") + "Z");
  if (isNaN(date.getTime())) return String(utcDatetime);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ODOO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

const SALE_ORDER_BASE_HEADERS = [
  "ID",
  "Número",
  "Cliente",
  "Vendedor",
  "Empresa",
  "Monto Total",
  "Moneda",
  "Estado",
  "Estado de la factura",
  "Productos",
  "Días desde creación",
];

/** Base columns + one column per date field Odoo reports (fields_get). */
function saleOrderHeaders(dateFields: OdooDateField[]): string[] {
  return [...SALE_ORDER_BASE_HEADERS, ...dateFields.map((f) => f.label)];
}

const STATE_ES: Record<string, string> = {
  draft: "Cotización",
  sent: "Cotización enviada",
  sale: "Orden de venta",
  done: "Bloqueada",
  cancel: "Cancelada",
};

const INVOICE_STATUS_ES: Record<string, string> = {
  "to invoice": "Por facturar",
  invoiced: "Facturado",
  no: "Nada que facturar",
  upselling: "Oportunidad de venta adicional",
};

function saleOrderRow(
  o: OdooSalesOrder,
  dateFields: OdooDateField[],
  productCodes: Map<number, string>
): string[] {
  const created = o.create_date ? new Date(o.create_date.replace(" ", "T") + "Z") : null;
  const daysSinceCreation = created
    ? Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24))
    : "";

  return [
    String(o.id || ""),
    o.name || "",
    Array.isArray(o.partner_id) ? o.partner_id[1] : "",
    Array.isArray(o.user_id) ? o.user_id[1] : "",
    Array.isArray(o.company_id) ? o.company_id[1] : "",
    String(o.amount_total ?? ""),
    Array.isArray(o.currency_id) ? o.currency_id[1] : "",
    STATE_ES[o.state] ?? o.state ?? "",
    o.invoice_status ? INVOICE_STATUS_ES[o.invoice_status] ?? o.invoice_status : "",
    productCodes.get(o.id) ?? "",
    String(daysSinceCreation),
    ...dateFields.map((f) => formatOdooDatetime(o[f.name] as string | false | undefined)),
  ];
}

/** Write sales orders to their own spreadsheet */
export async function writeSalesOrdersToAnalysisSheet(
  orders: OdooSalesOrder[],
  dateFields: OdooDateField[] = [],
  productCodes: Map<number, string> = new Map()
): Promise<string | undefined> {
  if (!orders || orders.length === 0) return undefined;

  return writeAnalysisFile("ordersSheetId", [
    saleOrderHeaders(dateFields),
    ...orders.map((o) => saleOrderRow(o, dateFields, productCodes)),
  ]);
}

/**
 * Build a map of order id → product codes concatenated with ", "
 * (e.g. "M18-4VPDL-Q8, M18-3VPLV-Q8, BRT-2X2"). Section/note lines
 * ("Sustituto de...") are skipped — only real products.
 */
export function buildProductCodesByOrder(lines: OdooOrderLine[]): Map<number, string> {
  const codesByOrder = new Map<number, string[]>();

  for (const l of lines) {
    if (l.display_type || !Array.isArray(l.product_id) || !Array.isArray(l.order_id)) continue;

    // Odoo's display name is "[CODE] Product name" when a code exists.
    const display = l.product_id[1];
    const match = display.match(/^\[(.+?)\]/);
    const code = match ? match[1] : display;

    const orderId = l.order_id[0];
    const codes = codesByOrder.get(orderId) ?? [];
    if (!codes.includes(code)) codes.push(code);
    codesByOrder.set(orderId, codes);
  }

  return new Map([...codesByOrder].map(([id, codes]) => [id, codes.join(", ")]));
}

/** Write quotations to their own spreadsheet */
export async function writeQuotationsToAnalysisSheet(
  quotations: OdooSalesOrder[],
  dateFields: OdooDateField[] = [],
  productCodes: Map<number, string> = new Map()
): Promise<string | undefined> {
  if (!quotations || quotations.length === 0) return undefined;

  return writeAnalysisFile("quotationsSheetId", [
    saleOrderHeaders(dateFields),
    ...quotations.map((q) => saleOrderRow(q, dateFields, productCodes)),
  ]);
}

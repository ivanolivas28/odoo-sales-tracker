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

export async function getGoogleStatus(): Promise<{ connected: boolean; spreadsheetUrl?: string }> {
  await connectMongo();
  const settings = await Settings.findOne({ key: "google" });
  return {
    connected: !!settings?.googleRefreshToken,
    spreadsheetUrl: settings?.spreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/edit`
      : undefined,
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

const HEADER = ["Tipo", "Empresa / Contacto", "Correo", "WhatsApp", "Motivo", "Monto (MXN)", "Actualizado"];

/** Creates the leads spreadsheet on first run, then overwrites its contents on every subsequent sync. */
export async function syncLeadsSheet(rows: string[][]): Promise<string> {
  const auth = await getAuthedClient();
  const sheets = google.sheets({ version: "v4", auth });

  await connectMongo();
  const settings = await Settings.findOne({ key: "google" });
  let spreadsheetId = settings?.spreadsheetId;

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

interface OdooContact {
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

interface OdooSalesOrder {
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
}

/** Create or get analysis spreadsheet with contacts, orders, and quotations */
export async function createOrGetAnalysisSheet(): Promise<string> {
  const auth = await getAuthedClient();
  const sheets = google.sheets({ version: "v4", auth });

  await connectMongo();
  const settings = await Settings.findOne({ key: "google" });
  let analysisSheetId = settings?.analysisSheetId;

  if (!analysisSheetId) {
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: "Odoo Sales Tracker - Analysis",
        },
        sheets: [
          { properties: { title: "Contactos" } },
          { properties: { title: "Órdenes" } },
          { properties: { title: "Cotizaciones" } },
          { properties: { title: "Instrucciones" } },
        ],
      },
    });
    analysisSheetId = created.data.spreadsheetId ?? undefined;
    if (!analysisSheetId) throw new Error("Google did not return a spreadsheet id");
    await Settings.findOneAndUpdate({ key: "google" }, { analysisSheetId });
  }

  return `https://docs.google.com/spreadsheets/d/${analysisSheetId}/edit`;
}

/** Write contacts to analysis sheet */
export async function writeContactsToAnalysisSheet(contacts: OdooContact[]): Promise<void> {
  if (!contacts || contacts.length === 0) return;

  const auth = await getAuthedClient();
  const sheets = google.sheets({ version: "v4", auth });

  await connectMongo();
  const settings = await Settings.findOne({ key: "google" });
  const analysisSheetId = settings?.analysisSheetId;
  if (!analysisSheetId) throw new Error("Analysis sheet not found");

  const headers = ["ID", "Nombre", "Email", "Teléfono", "Móvil", "Ciudad", "Industria", "¿Cliente?", "Creado", "Actualizado"];

  const rows = contacts.map((c) => [
    String(c.id || ""),
    c.name || "",
    c.email || "",
    c.phone || "",
    c.mobile || "",
    c.city || "",
    c.industry_id ? c.industry_id[1] : "",
    c.customer_rank && c.customer_rank > 0 ? "Sí" : "No",
    c.create_date ? new Date(c.create_date).toLocaleDateString("es-MX") : "",
    c.write_date ? new Date(c.write_date).toLocaleDateString("es-MX") : "",
  ]);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: analysisSheetId,
    range: "Contactos!A1:J10000",
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: analysisSheetId,
    range: "Contactos!A1",
    valueInputOption: "RAW",
    requestBody: { values: [headers, ...rows] },
  });
}

/** Write sales orders to analysis sheet */
export async function writeSalesOrdersToAnalysisSheet(orders: OdooSalesOrder[]): Promise<void> {
  if (!orders || orders.length === 0) return;

  const auth = await getAuthedClient();
  const sheets = google.sheets({ version: "v4", auth });

  await connectMongo();
  const settings = await Settings.findOne({ key: "google" });
  const analysisSheetId = settings?.analysisSheetId;
  if (!analysisSheetId) throw new Error("Analysis sheet not found");

  const headers = ["ID", "Número", "Cliente", "Fecha de creación", "Fecha de orden", "Monto Total", "Moneda", "Estado", "Días desde creación"];

  const now = new Date();
  const rows = orders.map((o) => {
    const createDate = new Date(o.create_date);
    const daysSinceCreation = Math.floor((now.getTime() - createDate.getTime()) / (1000 * 60 * 60 * 24));

    return [
      String(o.id || ""),
      o.name || "",
      Array.isArray(o.partner_id) ? o.partner_id[1] : String(o.partner_id),
      o.create_date ? new Date(o.create_date).toLocaleDateString("es-MX") : "",
      o.date_order ? new Date(o.date_order).toLocaleDateString("es-MX") : "",
      String(o.amount_total || 0),
      o.currency_id ? (Array.isArray(o.currency_id) ? o.currency_id[1] : "USD") : "MXN",
      o.state || "",
      String(daysSinceCreation),
    ];
  });

  await sheets.spreadsheets.values.clear({
    spreadsheetId: analysisSheetId,
    range: "Órdenes!A1:I10000",
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: analysisSheetId,
    range: "Órdenes!A1",
    valueInputOption: "RAW",
    requestBody: { values: [headers, ...rows] },
  });
}

/** Write quotations to analysis sheet */
export async function writeQuotationsToAnalysisSheet(quotations: OdooSalesOrder[]): Promise<void> {
  if (!quotations || quotations.length === 0) return;

  const auth = await getAuthedClient();
  const sheets = google.sheets({ version: "v4", auth });

  await connectMongo();
  const settings = await Settings.findOne({ key: "google" });
  const analysisSheetId = settings?.analysisSheetId;
  if (!analysisSheetId) throw new Error("Analysis sheet not found");

  const headers = ["ID", "Número", "Cliente", "Fecha de creación", "Fecha de orden", "Monto Total", "Moneda", "Estado", "Días pendiente"];

  const now = new Date();
  const rows = quotations.map((q) => {
    const writeDate = new Date(q.write_date);
    const daysPending = Math.floor((now.getTime() - writeDate.getTime()) / (1000 * 60 * 60 * 24));

    return [
      String(q.id || ""),
      q.name || "",
      Array.isArray(q.partner_id) ? q.partner_id[1] : String(q.partner_id),
      q.create_date ? new Date(q.create_date).toLocaleDateString("es-MX") : "",
      q.date_order ? new Date(q.date_order).toLocaleDateString("es-MX") : "",
      String(q.amount_total || 0),
      q.currency_id ? (Array.isArray(q.currency_id) ? q.currency_id[1] : "USD") : "MXN",
      q.state || "",
      String(daysPending),
    ];
  });

  await sheets.spreadsheets.values.clear({
    spreadsheetId: analysisSheetId,
    range: "Cotizaciones!A1:I10000",
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: analysisSheetId,
    range: "Cotizaciones!A1",
    valueInputOption: "RAW",
    requestBody: { values: [headers, ...rows] },
  });
}

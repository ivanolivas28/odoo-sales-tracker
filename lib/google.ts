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
  let needsCreation = !analysisSheetId;

  if (analysisSheetId) {
    try {
      await sheets.spreadsheets.get({ spreadsheetId: analysisSheetId });
    } catch (err) {
      console.log("[SYNC] Analysis sheet not found in Google Drive, creating new one");
      needsCreation = true;
      analysisSheetId = undefined;
    }
  }

  if (needsCreation) {
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

  const headers = ["ID", "Nombre"];

  const rows = contacts.map((c) => [String(c.id || ""), c.name || ""]);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: analysisSheetId,
    range: "Contactos!A1:B10000",
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

  const headers = ["ID", "Número", "Estado"];

  const rows = orders.map((o) => [String(o.id || ""), o.name || "", o.state || ""]);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: analysisSheetId,
    range: "Órdenes!A1:C10000",
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

  const headers = ["ID", "Número", "Estado"];

  const rows = quotations.map((q) => [String(q.id || ""), q.name || "", q.state || ""]);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: analysisSheetId,
    range: "Cotizaciones!A1:C10000",
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: analysisSheetId,
    range: "Cotizaciones!A1",
    valueInputOption: "RAW",
    requestBody: { values: [headers, ...rows] },
  });
}

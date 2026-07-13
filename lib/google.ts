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

import {
  executeKw,
  fetchAllContactsPaginated,
  fetchSalesOrdersAboveThreshold,
  fetchOrderLines,
} from "@/lib/odoo";
import { connectMongo } from "@/lib/mongodb";
import { Task, TASK_PRIORITY, type TaskType } from "@/models/Task";
import { formatCurrency } from "@/lib/salesAggregates";
import { fetchContactChannels, normalizeWhatsappNumber, whatsappLink } from "@/lib/contact";
import { generateOutreachCopy } from "@/lib/anthropic";
import {
  isGoogleConnected,
  syncLeadsSheet,
  writeContactsToAnalysisSheet,
  writeSalesOrdersToAnalysisSheet,
  writeQuotationsToAnalysisSheet,
  buildProductCodesByOrder,
  formatOdooDatetime,
} from "@/lib/google";

const URGENT_VIP_DAYS = 60;
const HOT_QUOTATION_DAYS = 7;
const REACTIVATION_DAYS = 240; // ~8 months
const VIP_MIN_COUNT = 5;
const VIP_TOP_FRACTION = 0.2;

interface ConfirmedOrder {
  partner_id: [number, string] | false;
  amount_total: number;
  date_order: string;
}

interface Quotation {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  amount_total: number;
  date_order: string;
}

interface Stage {
  id: number;
  name: string;
  sequence: number;
}

interface Lead {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  email_from: string | false;
  create_date: string;
}

interface PartnerCommercial {
  id: number;
  commercial_partner_id: [number, string] | false;
}

interface TaskCandidate {
  key: string;
  type: TaskType;
  partnerId: number;
  partnerName: string;
  refModel?: string;
  refId?: number;
  reason: string;
  amount?: number;
  /** Odoo datetime of the underlying record (quotation, lead, or last order). */
  sourceDate?: string;
}

function daysSince(dateStr: string): number {
  const then = new Date(dateStr.replace(" ", "T") + "Z").getTime();
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

async function fetchOdooContext() {
  const [confirmedOrders, quotations, stages] = await Promise.all([
    executeKw<ConfirmedOrder[]>(
      "sale.order",
      "search_read",
      [[["state", "in", ["sale", "done"]]]],
      { fields: ["partner_id", "amount_total", "date_order"], limit: 5000 }
    ),
    executeKw<Quotation[]>(
      "sale.order",
      "search_read",
      [[["state", "in", ["draft", "sent"]]]],
      { fields: ["name", "partner_id", "amount_total", "date_order"], limit: 2000 }
    ),
    executeKw<Stage[]>("crm.stage", "search_read", [[]], {
      fields: ["name", "sequence"],
      order: "sequence asc",
      limit: 1,
    }),
  ]);

  const firstStageId = stages[0]?.id;
  const leads = firstStageId
    ? await executeKw<Lead[]>(
        "crm.lead",
        "search_read",
        [[["stage_id", "=", firstStageId], ["active", "=", true]]],
        { fields: ["name", "partner_id", "email_from", "create_date"], limit: 500 }
      )
    : [];

  // Contacts (e.g. "Company, Jane Doe") must roll up to their parent company for
  // purchase-history purposes — otherwise a contact's own idle gap can hide a
  // very recent order placed under the company record (or a sibling contact).
  const confirmedPartnerIds = [...new Set(confirmedOrders.map((o) => o.partner_id && o.partner_id[0]).filter((id): id is number => !!id))];
  const commercialPartners = confirmedPartnerIds.length
    ? await executeKw<PartnerCommercial[]>(
        "res.partner",
        "read",
        [confirmedPartnerIds],
        { fields: ["commercial_partner_id"] }
      )
    : [];

  const commercialByPartnerId = new Map<number, { id: number; name: string }>();
  for (const p of commercialPartners) {
    if (p.commercial_partner_id) {
      commercialByPartnerId.set(p.id, { id: p.commercial_partner_id[0], name: p.commercial_partner_id[1] });
    }
  }

  return { confirmedOrders, quotations, leads, commercialByPartnerId };
}

function buildCandidates(context: Awaited<ReturnType<typeof fetchOdooContext>>): TaskCandidate[] {
  const { confirmedOrders, quotations, leads, commercialByPartnerId } = context;
  const candidates: TaskCandidate[] = [];

  const revenueByPartner = new Map<number, { name: string; total: number; lastOrder: string }>();
  for (const order of confirmedOrders) {
    if (!order.partner_id) continue;
    const [rawId, rawName] = order.partner_id;
    const commercial = commercialByPartnerId.get(rawId);
    const id = commercial?.id ?? rawId;
    const name = commercial?.name ?? rawName;

    const existing = revenueByPartner.get(id);
    if (!existing) {
      revenueByPartner.set(id, { name, total: order.amount_total, lastOrder: order.date_order });
    } else {
      existing.total += order.amount_total;
      if (order.date_order > existing.lastOrder) existing.lastOrder = order.date_order;
    }
  }

  const vipCount = Math.max(VIP_MIN_COUNT, Math.ceil(revenueByPartner.size * VIP_TOP_FRACTION));
  const vipIds = new Set(
    [...revenueByPartner.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, vipCount)
      .map(([id]) => id)
  );

  for (const [partnerId, info] of revenueByPartner) {
    const idle = daysSince(info.lastOrder);
    if (vipIds.has(partnerId) && idle >= URGENT_VIP_DAYS) {
      candidates.push({
        key: `urgent_call:${partnerId}`,
        type: "urgent_call",
        partnerId,
        partnerName: info.name,
        reason: `VIP client — ${idle} days since last purchase (lifetime ${formatCurrency(info.total)})`,
        amount: info.total,
        sourceDate: info.lastOrder,
      });
    } else if (idle >= REACTIVATION_DAYS) {
      candidates.push({
        key: `reactivation:${partnerId}`,
        type: "reactivation",
        partnerId,
        partnerName: info.name,
        reason: `Dormant client — ${idle} days (${Math.round(idle / 30)} months) since last purchase`,
        amount: info.total,
        sourceDate: info.lastOrder,
      });
    }
  }

  for (const quote of quotations) {
    if (!quote.partner_id) continue;
    const idle = daysSince(quote.date_order);
    if (idle < HOT_QUOTATION_DAYS) continue;
    const [partnerId, partnerName] = quote.partner_id;
    candidates.push({
      key: `hot_followup:${quote.id}`,
      type: "hot_followup",
      partnerId,
      partnerName,
      refModel: "sale.order",
      refId: quote.id,
      reason: `Quotation ${quote.name} (${formatCurrency(quote.amount_total)}) sent ${idle} days ago — no response yet`,
      amount: quote.amount_total,
      sourceDate: quote.date_order,
    });
  }

  for (const lead of leads) {
    const partnerId = lead.partner_id ? lead.partner_id[0] : 0;
    const partnerName = lead.partner_id ? lead.partner_id[1] : lead.email_from || lead.name;
    candidates.push({
      key: `prospecting:${lead.id}`,
      type: "prospecting",
      partnerId,
      partnerName,
      refModel: "crm.lead",
      refId: lead.id,
      reason: `New lead "${lead.name}" — not yet contacted`,
      sourceDate: lead.create_date,
    });
  }

  return candidates;
}

const TYPE_LABEL_ES: Record<TaskType, string> = {
  urgent_call: "Urgente - Llamar",
  hot_followup: "Caliente - Seguimiento",
  prospecting: "Prospección",
  reactivation: "Reactivación",
};

interface PartnerLookup {
  id: number;
  email: string | false;
  phone: string | false;
  mobile: string | false;
}

interface LeadLookup {
  id: number;
  email_from: string | false;
  phone: string | false;
  mobile: string | false;
}

async function buildLeadsRows(candidates: TaskCandidate[]): Promise<string[][]> {
  const partnerIds = [...new Set(candidates.filter((c) => c.refModel !== "crm.lead" && c.partnerId).map((c) => c.partnerId))];
  const leadIds = [...new Set(candidates.filter((c) => c.refModel === "crm.lead" && c.refId).map((c) => c.refId as number))];

  const [partners, leads] = await Promise.all([
    partnerIds.length
      ? executeKw<PartnerLookup[]>("res.partner", "read", [partnerIds], { fields: ["email", "phone", "mobile"] })
      : Promise.resolve([] as PartnerLookup[]),
    leadIds.length
      ? executeKw<LeadLookup[]>("crm.lead", "read", [leadIds], { fields: ["email_from", "phone", "mobile"] })
      : Promise.resolve([] as LeadLookup[]),
  ]);

  const partnerById = new Map(partners.map((p) => [p.id, p]));
  const leadById = new Map(leads.map((l) => [l.id, l]));

  return [...candidates]
    .sort((a, b) => TASK_PRIORITY[a.type] - TASK_PRIORITY[b.type])
    .map((c) => {
      let email = "";
      let phone = "";
      if (c.refModel === "crm.lead" && c.refId) {
        const lead = leadById.get(c.refId);
        email = (lead?.email_from as string) || "";
        phone = normalizeWhatsappNumber(lead?.mobile || lead?.phone || undefined) || "";
      } else {
        const partner = partnerById.get(c.partnerId);
        email = (partner?.email as string) || "";
        phone = normalizeWhatsappNumber(partner?.mobile || partner?.phone || undefined) || "";
      }
      return [
        TYPE_LABEL_ES[c.type],
        c.partnerName,
        email,
        phone,
        c.reason,
        c.amount !== undefined ? String(Math.round(c.amount)) : "",
        formatOdooDatetime(c.sourceDate),
      ];
    });
}

async function upsertTask(candidate: TaskCandidate): Promise<"created" | "updated" | "skipped"> {
  const existing = await Task.findOne({ key: candidate.key });

  if (existing) {
    if (existing.status === "done" && existing.nextFollowUpDate && existing.nextFollowUpDate > new Date()) {
      return "skipped";
    }
    if (existing.status === "pending") {
      existing.reason = candidate.reason;
      existing.amount = candidate.amount;
      await existing.save();
      return "updated";
    }
  }

  await Task.create({ ...candidate, status: "pending" });
  return "created";
}

export async function runSync() {
  await connectMongo();

  // Sync analysis data to Google Sheets: one spreadsheet per dataset so the
  // Claude Cowork Drive connector (which only reads a file's first tab) can
  // access all of them.
  let contactsSheetUrl: string | undefined;
  let ordersSheetUrl: string | undefined;
  let quotationsSheetUrl: string | undefined;
  if (await isGoogleConnected()) {
    try {
      console.log("[SYNC] Fetching all contacts and orders/quotations for analysis sheets...");
      const [allContacts, { confirmedOrders, quotations, dateFields }] = await Promise.all([
        fetchAllContactsPaginated(),
        fetchSalesOrdersAboveThreshold(1000),
      ]);

      console.log(`[SYNC] Fetched ${allContacts.length} contacts, ${confirmedOrders.length} confirmed orders, ${quotations.length} quotations`);

      // Product codes per order, shown as "M18-4VPDL-Q8, BRT-2X2, ..."
      const orderIds = [...confirmedOrders, ...quotations].map((o) => o.id);
      const productCodes =
        orderIds.length > 0 ? buildProductCodesByOrder(await fetchOrderLines(orderIds)) : new Map<number, string>();

      contactsSheetUrl = await writeContactsToAnalysisSheet(allContacts);
      console.log(`[SYNC] Contacts sheet: ${contactsSheetUrl}`);

      ordersSheetUrl = await writeSalesOrdersToAnalysisSheet(confirmedOrders, dateFields, productCodes);
      console.log(`[SYNC] Orders sheet: ${ordersSheetUrl}`);

      quotationsSheetUrl = await writeQuotationsToAnalysisSheet(quotations, dateFields, productCodes);
      console.log(`[SYNC] Quotations sheet: ${quotationsSheetUrl}`);
    } catch (err) {
      console.error("[SYNC] Analysis sheets export failed:", err);
    }
  }

  const context = await fetchOdooContext();
  const candidates = buildCandidates(context);

  const tally = { created: 0, updated: 0, skipped: 0 };
  for (const candidate of candidates) {
    const result = await upsertTask(candidate);
    tally[result] += 1;
  }

  // Every rule is recomputed from the full current Odoo state each run, so any
  // pending task whose key didn't reappear no longer reflects reality (e.g. the
  // customer bought again, the quotation was confirmed/cancelled, the lead moved
  // stages) — retire it rather than leaving a stale suggestion in the inbox.
  const validKeys = candidates.map((c) => c.key);
  const { deletedCount } = await Task.deleteMany({ status: "pending", key: { $nin: validKeys } });

  let sheetUrl: string | undefined;
  if (await isGoogleConnected()) {
    try {
      const rows = await buildLeadsRows(candidates);
      sheetUrl = await syncLeadsSheet(rows);
    } catch (err) {
      console.error("Google Sheets export failed:", err);
    }
  }

  return {
    candidates: candidates.length,
    ...tally,
    retired: deletedCount,
    sheetUrl,
    contactsSheetUrl,
    ordersSheetUrl,
    quotationsSheetUrl,
    ranAt: new Date().toISOString(),
  };
}

const CHANNEL_BY_TYPE: Record<TaskType, "call" | "email"> = {
  urgent_call: "call",
  hot_followup: "call",
  prospecting: "email",
  reactivation: "email",
};

const NEXT_FOLLOWUP_DAYS: Record<TaskType, number> = {
  urgent_call: 14,
  hot_followup: 5,
  prospecting: 7,
  reactivation: 30,
};

export async function completeTask(taskId: string) {
  await connectMongo();
  const task = await Task.findById(taskId);
  if (!task) throw new Error("Task not found");
  if (task.status === "done") throw new Error("Task already completed");

  const targetModel = task.refModel === "crm.lead" ? "crm.lead" : "res.partner";
  const targetId = task.refModel === "crm.lead" ? task.refId : task.partnerId;
  if (!targetId) throw new Error("Task has no linked Odoo record");

  const baseChannel = CHANNEL_BY_TYPE[task.type as TaskType];
  const { phone, email } = await fetchContactChannels(task.refModel, task.refId, task.partnerId);

  let generatedContent: {
    channel: "whatsapp" | "email" | "no_phone";
    subject?: string;
    message?: string;
    phone?: string;
    email?: string;
    waLink?: string;
  };
  let logBody: string;
  let actTypeXmlId: string;

  if (baseChannel === "call") {
    if (phone) {
      const { message } = await generateOutreachCopy({
        channel: "whatsapp",
        taskType: task.type,
        partnerName: task.partnerName,
        reason: task.reason,
        amount: task.amount ?? undefined,
      });
      generatedContent = { channel: "whatsapp", message, phone, waLink: whatsappLink(phone, message) };
      logBody = `Sent WhatsApp message: ${message}`;
      actTypeXmlId = "mail.mail_activity_data_call";
    } else {
      generatedContent = { channel: "no_phone" };
      logBody = `Attempted contact — no phone on file. Reason: ${task.reason}`;
      actTypeXmlId = "mail.mail_activity_data_call";
    }
  } else {
    const { subject, message } = await generateOutreachCopy({
      channel: "email",
      taskType: task.type,
      partnerName: task.partnerName,
      reason: task.reason,
      amount: task.amount ?? undefined,
    });
    generatedContent = { channel: "email", subject, message, email };
    logBody = `Drafted email — Subject: ${subject}\n\n${message}`;
    actTypeXmlId = "mail.mail_activity_data_email";
  }

  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + NEXT_FOLLOWUP_DAYS[task.type as TaskType]);
  const nextDateStr = nextDate.toISOString().slice(0, 10);

  await executeKw(targetModel, "message_post", [[targetId]], { body: logBody });

  await executeKw(targetModel, "activity_schedule", [[targetId]], {
    act_type_xmlid: actTypeXmlId,
    summary: `Follow up: ${task.partnerName}`,
    note: task.reason,
    date_deadline: nextDateStr,
  });

  task.status = "done";
  task.completedAt = new Date();
  task.nextFollowUpDate = nextDate;
  task.generatedContent = generatedContent;
  await task.save();

  return task;
}

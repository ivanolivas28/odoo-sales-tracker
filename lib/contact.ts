import { executeKw } from "@/lib/odoo";

export interface ContactChannels {
  phone?: string;
  email?: string;
}

interface PartnerContact {
  phone: string | false;
  mobile: string | false;
  email: string | false;
}

interface LeadContact {
  phone: string | false;
  mobile: string | false;
  email_from: string | false;
}

export async function fetchContactChannels(
  refModel: string | undefined,
  refId: number | undefined,
  partnerId: number
): Promise<ContactChannels> {
  if (refModel === "crm.lead" && refId) {
    const [lead] = await executeKw<LeadContact[]>("crm.lead", "read", [[refId]], {
      fields: ["phone", "mobile", "email_from"],
    });
    return {
      phone: normalizeWhatsappNumber(lead?.mobile || lead?.phone || undefined),
      email: lead?.email_from || undefined,
    };
  }

  if (!partnerId) return {};

  const [partner] = await executeKw<PartnerContact[]>("res.partner", "read", [[partnerId]], {
    fields: ["phone", "mobile", "email"],
  });
  return {
    phone: normalizeWhatsappNumber(partner?.mobile || partner?.phone || undefined),
    email: partner?.email || undefined,
  };
}

/** Best-effort normalization to a WhatsApp-ready international number (digits only). */
export function normalizeWhatsappNumber(raw: string | false | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.length === 10) return `52${digits}`; // bare MX national number
  return digits;
}

export function whatsappLink(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

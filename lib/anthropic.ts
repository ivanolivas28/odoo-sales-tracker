import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured — add it to .env.local");
  }
  if (!client) client = new Anthropic();
  return client;
}

interface OutreachInput {
  channel: "whatsapp" | "email";
  taskType: string;
  partnerName: string;
  reason: string;
  amount?: number;
}

interface OutreachCopy {
  subject?: string;
  message: string;
}

const WHATSAPP_SYSTEM = `Escribes mensajes de WhatsApp breves (3-4 líneas máximo) en español de México, en nombre de Eqkor Industrial Supplier, para reconectar con un cliente industrial. Tono cercano pero profesional, sin relleno corporativo. Usa como máximo un emoji, y solo si aporta calidez sin restar seriedad. No empieces con "Estimado cliente" — dirígete a la persona de forma natural. Devuelve ÚNICAMENTE el texto del mensaje, sin comillas ni explicaciones.`;

const EMAIL_SYSTEM = `Escribes correos de ventas breves y profesionales en español de México, en nombre de Eqkor Industrial Supplier, dirigidos a clientes o prospectos industriales. Responde ÚNICAMENTE con un objeto JSON de la forma {"subject": "...", "body": "..."} — el "body" en texto plano (sin HTML), con saltos de línea donde correspondan. Sin explicaciones ni texto fuera del JSON.`;

export async function generateOutreachCopy(input: OutreachInput): Promise<OutreachCopy> {
  const { channel, taskType, partnerName, reason, amount } = input;

  const context = [
    `Cliente: ${partnerName}`,
    `Tipo de tarea: ${taskType}`,
    `Motivo del contacto: ${reason}`,
    amount !== undefined ? `Monto relacionado: $${amount.toFixed(2)} MXN` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await getClient().messages.create({
    model: "claude-opus-4-8",
    max_tokens: 512,
    system: channel === "whatsapp" ? WHATSAPP_SYSTEM : EMAIL_SYSTEM,
    messages: [{ role: "user", content: context }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

  if (channel === "email") {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (typeof parsed.body === "string") {
          return { subject: typeof parsed.subject === "string" ? parsed.subject : undefined, message: parsed.body };
        }
      } catch {
        // fall through to raw text below
      }
    }
    return { subject: `Seguimiento — ${partnerName}`, message: raw };
  }

  return { message: raw };
}

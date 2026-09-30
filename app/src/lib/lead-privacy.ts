import type { Role } from "@crm/db";

/**
 * Privacidade do contato dos leads — aplicada NO SERVIDOR, antes de a resposta sair.
 *
 * Regra (mesma dona de lead que o resto do sistema usa: lead.currentBrokerId):
 * - Dono/admin: vê tudo normalmente.
 * - Corretor: vê telefone/e-mail completos só dos leads que estão com ele agora
 *   (currentBrokerId === brokerId dele — inclui o lead que está na vez dele na roleta).
 *   Nos demais, telefone/e-mail (e respostas do formulário que sejam contato) saem
 *   mascarados já na API: o valor completo nunca chega ao navegador, nem via DevTools.
 */

export type Viewer = { role: Role; brokerId: string | null };

export function canSeeLeadContact(viewer: Viewer, lead: { currentBrokerId: string | null }): boolean {
  if (viewer.role !== "BROKER") return true;
  return Boolean(viewer.brokerId) && lead.currentBrokerId === viewer.brokerId;
}

/** "(47) 99999-9999" → "(47) 9****-****". Sem dígitos suficientes → "(**) *****-****". */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return phone;
  let digits = phone.replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length < 10) return "(**) *****-****";
  return `(${digits.slice(0, 2)}) ${digits[2]}****-****`;
}

/** "joao.silva@gmail.com" → "j*****@gmail.com". */
export function maskEmail(email: string | null): string | null {
  if (!email) return email;
  const at = email.indexOf("@");
  if (at < 1) return "*****";
  return `${email[0]}*****${email.slice(at)}`;
}

const CONTACT_KEY = /phone|telefone|celular|whats|fone|tel\b|e-?mail|mail/i;
const EMAIL_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function looksLikePhone(value: string) {
  return value.replace(/\D/g, "").length >= 8 && /^[\d\s()+.-]+$/.test(value.trim());
}

/**
 * Respostas do formulário da Meta também trazem telefone/e-mail (ex.: "phone_number",
 * "email", "Seu melhor WhatsApp"). Mascara pela chave OU pelo formato do valor.
 */
export function maskContactCustomFields(fields: unknown): { fields: Record<string, unknown>; protectedKeys: string[] } {
  const source = (fields && typeof fields === "object" ? fields : {}) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  const protectedKeys: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    const text = value == null ? "" : String(value);
    const isEmail = EMAIL_VALUE.test(text);
    if (CONTACT_KEY.test(key) || isEmail || looksLikePhone(text)) {
      result[key] = isEmail ? maskEmail(text.match(EMAIL_VALUE)![0]) : maskPhone(text);
      protectedKeys.push(key);
    } else {
      result[key] = value;
    }
  }
  return { fields: result, protectedKeys };
}

/**
 * Devolve a versão do lead que este usuário pode ver. `contactProtected: true` indica ao
 * frontend que deve exibir o cadeado/desfoque (o valor já vem mascarado de qualquer forma).
 */
export function applyLeadContactPrivacy<
  T extends { currentBrokerId: string | null; phone?: string | null; email?: string | null; customFields?: unknown },
>(viewer: Viewer, lead: T): T & { contactProtected: boolean; protectedFieldKeys: string[] } {
  if (canSeeLeadContact(viewer, lead)) return { ...lead, contactProtected: false, protectedFieldKeys: [] };

  const masked: T & { contactProtected: boolean; protectedFieldKeys: string[] } = {
    ...lead,
    contactProtected: true,
    protectedFieldKeys: [],
  };
  if ("phone" in lead) masked.phone = maskPhone(lead.phone ?? null);
  if ("email" in lead) masked.email = maskEmail(lead.email ?? null);
  if ("customFields" in lead) {
    const { fields, protectedKeys } = maskContactCustomFields(lead.customFields);
    masked.customFields = fields;
    masked.protectedFieldKeys = protectedKeys;
  }
  return masked;
}

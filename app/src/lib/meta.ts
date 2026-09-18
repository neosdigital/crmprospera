import crypto from "crypto";

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Valida a assinatura do payload do webhook conforme documentação oficial da Meta
 * (docs/graph-api/webhooks/getting-started): HMAC-SHA256 do corpo bruto da requisição
 * usando o App Secret, comparado ao header `X-Hub-Signature-256: sha256=<hex>`.
 * Precisa do corpo BRUTO (string), não do JSON já parseado, senão a assinatura não bate.
 */
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return false;

  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export type LeadgenChangeValue = {
  leadgen_id: string;
  page_id: string;
  form_id: string;
  adgroup_id?: string;
  ad_id?: string;
  created_time: number;
};

export type MetaWebhookPayload = {
  object: string;
  entry: {
    id: string;
    time: number;
    changes: { field: string; value: LeadgenChangeValue }[];
  }[];
};

type FieldDatum = { name: string; values: string[] };

export type MetaLeadDetails = {
  id: string;
  created_time: string;
  ad_id?: string;
  form_id?: string;
  field_data?: FieldDatum[];
};

async function graphGet<T>(path: string, accessToken: string, fields?: string): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  if (fields) url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString());
  const json = await res.json();
  if (!res.ok) {
    const message = json?.error?.message || `Erro ao chamar a Graph API (${res.status})`;
    throw new Error(message);
  }
  return json as T;
}

/** Busca os dados completos de um lead a partir do leadgen_id recebido no webhook. */
export async function fetchLeadDetails(leadgenId: string, accessToken: string) {
  return graphGet<MetaLeadDetails>(
    `/${leadgenId}`,
    accessToken,
    "id,created_time,ad_id,form_id,field_data"
  );
}

/**
 * Enriquecimento best-effort com nome da campanha/conjunto/anúncio — a Meta não retorna
 * campaign_id diretamente no lead nem no webhook (confirmado na documentação atual), então
 * é necessário buscar via o ad_id. Chamado com try/catch pelo caller: se falhar (permissão,
 * anúncio arquivado, etc.), o lead ainda é salvo com os dados que já temos.
 */
export async function fetchAdContext(adId: string, accessToken: string) {
  return graphGet<{
    id: string;
    name: string;
    campaign?: { id: string; name: string };
    adset?: { id: string; name: string };
  }>(`/${adId}`, accessToken, "id,name,campaign{id,name},adset{id,name}");
}

export async function fetchFormName(formId: string, accessToken: string) {
  return graphGet<{ id: string; name: string }>(`/${formId}`, accessToken, "id,name");
}

/** Confere se um token/página ainda são válidos — usado no botão "Testar conexão". */
export async function testPageConnection(pageId: string, accessToken: string) {
  return graphGet<{ id: string; name: string }>(`/${pageId}`, accessToken, "id,name");
}

/**
 * Inscreve a Página no app para receber webhooks do campo "leadgen"
 * (POST /{page-id}/subscribed_apps?subscribed_fields=leadgen).
 */
export async function subscribePageToLeadgenWebhook(pageId: string, pageAccessToken: string) {
  const url = new URL(`${GRAPH_BASE}/${pageId}/subscribed_apps`);
  url.searchParams.set("subscribed_fields", "leadgen");
  url.searchParams.set("access_token", pageAccessToken);

  const res = await fetch(url.toString(), { method: "POST" });
  const json = await res.json();
  if (!res.ok || json?.success !== true) {
    const message = json?.error?.message || "Não foi possível inscrever a página no webhook.";
    throw new Error(message);
  }
  return json as { success: true };
}

/** Normaliza field_data (perguntas do formulário) para o formato custom_fields salvo no lead. */
export function normalizeFieldData(fieldData: FieldDatum[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fieldData ?? []) {
    result[field.name] = field.values?.join(", ") ?? "";
  }
  return result;
}

const NAME_KEYS = ["full_name", "nome", "name"];
const PHONE_KEYS = ["phone_number", "telefone", "phone"];
const EMAIL_KEYS = ["email"];

function pickField(fieldData: FieldDatum[] | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const match = fieldData?.find((f) => f.name.toLowerCase() === key);
    if (match?.values?.[0]) return match.values[0];
  }
  return undefined;
}

export function extractContactInfo(fieldData: FieldDatum[] | undefined) {
  return {
    name: pickField(fieldData, NAME_KEYS) ?? "Lead sem nome",
    phone: pickField(fieldData, PHONE_KEYS),
    email: pickField(fieldData, EMAIL_KEYS),
  };
}

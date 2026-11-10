import { LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "./index";
import { encryptSecret, decryptSecret } from "./crypto";
import { isQuietHours } from "./quiet-hours";
import { sendPersonalAreaPush } from "./push";
import { computeLostReturnAt, type LostReturnPeriod } from "./lost-return";

/**
 * ÁREA DO CORRETOR — captação particular pelo Meta.
 *
 * Módulo isolado da operação geral. Regras que este arquivo garante:
 * - Lead particular vai SEMPRE e SÓ para o corretor dono da conexão (definido pelo que está
 *   gravado no banco, nunca por um id vindo do navegador).
 * - Não chama nada de rotation.ts: não passa pela roleta, não mexe em rotation_state, não
 *   cria lead_assignments, não expira e não transfere.
 * - Não grava na tabela `leads` nem em `audit_logs`, então dashboards, relatórios, kanban
 *   geral e alertas existentes continuam exatamente iguais.
 * - Recebimento por consulta periódica aos formulários do corretor (GET /{form-id}/leads),
 *   feita pelo worker. O webhook geral (/api/webhooks/meta) e o app da Meta não mudam.
 * - Idempotente: (organization_id, meta_lead_id) é único — rodar a sincronização de novo,
 *   em paralelo ou depois de uma falha nunca duplica lead.
 */

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const PERSONAL_SOURCE_TYPE = "BROKER_PERSONAL_META";

/** Etapas da carteira particular. Sem "Expirado": lead particular não tem prazo nem roleta. */
export const PERSONAL_LEAD_STATUSES = [
  LeadStatus.NEW,
  LeadStatus.CONTACTED,
  LeadStatus.IN_PROGRESS,
  LeadStatus.QUALIFIED,
  LeadStatus.SCHEDULED,
  LeadStatus.CONVERTED,
  LeadStatus.LOST,
  LeadStatus.REMARKETING,
] as const;
export type PersonalLeadStatus = (typeof PERSONAL_LEAD_STATUSES)[number];

export function isPersonalLeadStatus(value: string): value is PersonalLeadStatus {
  return (PERSONAL_LEAD_STATUSES as readonly string[]).includes(value);
}

/** Margem ao consultar a Meta: busca a partir de (último lead importado − 10 min). */
const SYNC_OVERLAP_MS = 10 * 60 * 1000;
/** Máximo de páginas de 100 leads por formulário numa mesma passada. */
const SYNC_MAX_PAGES = 10;

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), scope: "PERSONAL_AREA", event, ...data }));
}

// ============================================================
// Graph API
// ============================================================

export class MetaGraphError extends Error {
  code?: number;
  subcode?: number;
  /** Token inválido/expirado/revogado: só resolve reconectando. */
  isAuthError: boolean;
  constructor(message: string, code?: number, subcode?: number) {
    super(message);
    this.code = code;
    this.subcode = subcode;
    // 190 = token inválido/expirado; 102 = sessão; 463/460/467 = expirado/senha trocada/inválido.
    this.isAuthError = code === 190 || code === 102 || [458, 459, 460, 463, 464, 467].includes(subcode ?? -1);
  }
}

type GraphFetch = typeof fetch;
let graphFetch: GraphFetch = (...args) => fetch(...args);
/** Só para testes: troca o fetch usado nas chamadas à Graph API. */
export function __setGraphFetchForTests(fn: GraphFetch | null) {
  graphFetch = fn ?? ((...args) => fetch(...args));
}

async function graphGetUrl<T>(url: URL): Promise<T> {
  const res = await graphFetch(url.toString());
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number; error_subcode?: number };
  };
  if (!res.ok || json.error) {
    const err = json.error ?? {};
    throw new MetaGraphError(err.message || `Erro ao chamar a Graph API (${res.status})`, err.code, err.error_subcode);
  }
  return json as T;
}

async function graphGet<T>(path: string, accessToken: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", accessToken);
  return graphGetUrl<T>(url);
}

type FieldDatum = { name: string; values?: string[] };

export type MetaPersonalLeadRaw = {
  id: string;
  created_time: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
  is_organic?: boolean;
  field_data?: FieldDatum[];
};

const LEAD_FIELDS =
  "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic,field_data";

const NAME_KEYS = ["full_name", "nome_completo", "nome completo", "nome", "name"];
const PHONE_KEYS = ["phone_number", "telefone", "phone"];
const EMAIL_KEYS = ["email", "e-mail", "e_mail", "work_email", "email_address", "endereço de e-mail", "endereço de email"];

function pickField(fieldData: FieldDatum[] | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const match = fieldData?.find((f) => f.name.toLowerCase() === key);
    if (match?.values?.[0]) return match.values[0];
  }
  return undefined;
}

/** Mesma regra de extração do webhook geral (cópia local para não tocar naquele código). */
export function extractPersonalContact(fieldData: FieldDatum[] | undefined) {
  const emailFallback = fieldData?.find(
    (f) => f.name.toLowerCase().includes("mail") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.values?.[0]?.trim() ?? "")
  )?.values?.[0]?.trim();
  return {
    name: pickField(fieldData, NAME_KEYS) ?? "Lead sem nome",
    phone: pickField(fieldData, PHONE_KEYS) ?? null,
    email: pickField(fieldData, EMAIL_KEYS) ?? emailFallback ?? null,
  };
}

export function normalizePersonalFieldData(fieldData: FieldDatum[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fieldData ?? []) result[field.name] = field.values?.join(", ") ?? "";
  return result;
}

// ============================================================
// Conexão (o corretor cola um token; nada muda no app da Meta)
// ============================================================

export type InspectedPage = { id: string; name: string };
export type InspectedForm = { id: string; name: string; status?: string };

type TokenInspection = {
  kind: "USER" | "PAGE";
  ownerName: string | null;
  pages: (InspectedPage & { pageToken: string })[];
};

/**
 * Descobre o que o token dá acesso, sem salvar nada. Aceita:
 * - token de Usuário: lista as Páginas que o usuário administra (/me/accounts) e usa o token
 *   de cada Página;
 * - token de Página: a própria Página.
 * Nunca devolve tokens para o navegador (quem chama expõe só id/nome).
 */
async function inspectToken(token: string): Promise<TokenInspection> {
  const me = await graphGet<{ id: string; name?: string }>("/me", token, { fields: "id,name" });
  try {
    const accounts = await graphGet<{ data?: { id: string; name: string; access_token?: string }[] }>(
      "/me/accounts",
      token,
      { fields: "id,name,access_token", limit: "100" }
    );
    const pages = (accounts.data ?? [])
      .filter((p) => p.access_token)
      .map((p) => ({ id: p.id, name: p.name, pageToken: p.access_token! }));
    return { kind: "USER", ownerName: me.name ?? null, pages };
  } catch (error) {
    if (error instanceof MetaGraphError && error.isAuthError) throw error;
    // Token de Página não tem /me/accounts: /me já é a própria Página.
    return { kind: "PAGE", ownerName: null, pages: [{ id: me.id, name: me.name ?? me.id, pageToken: token }] };
  }
}

async function listForms(pageId: string, pageToken: string): Promise<InspectedForm[]> {
  const res = await graphGet<{ data?: { id: string; name: string; status?: string }[] }>(
    `/${pageId}/leadgen_forms`,
    pageToken,
    { fields: "id,name,status", limit: "100" }
  );
  return (res.data ?? []).map((f) => ({ id: f.id, name: f.name, status: f.status }));
}

function friendlyMetaError(error: unknown): string {
  if (error instanceof MetaGraphError) {
    if (error.isAuthError) return "O token é inválido ou expirou. Gere um novo token e tente de novo.";
    if (error.code === 10 || error.code === 200 || error.code === 190) {
      return `A Meta recusou o acesso (permissão insuficiente): ${error.message}`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export class PersonalAreaError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Etapa 1 da conexão: o que o token enxerga (Páginas e, opcionalmente, formulários de uma Página). */
export async function inspectBrokerMetaToken(token: string, pageId?: string) {
  let inspection: TokenInspection;
  try {
    inspection = await inspectToken(token.trim());
  } catch (error) {
    throw new PersonalAreaError(422, friendlyMetaError(error));
  }
  if (inspection.pages.length === 0) {
    throw new PersonalAreaError(
      422,
      "Este token não dá acesso a nenhuma Página. Gere o token com a permissão pages_show_list e selecione a sua Página."
    );
  }

  let forms: InspectedForm[] | null = null;
  let formsError: string | null = null;
  const selected = pageId ? inspection.pages.find((p) => p.id === pageId) : inspection.pages.length === 1 ? inspection.pages[0] : undefined;
  if (selected) {
    try {
      forms = await listForms(selected.id, selected.pageToken);
    } catch (error) {
      formsError = friendlyMetaError(error);
    }
  }

  // Contas de anúncios: só informativo (o recebimento é pela Página/formulário). Depende da
  // permissão ads_read no token de usuário; sem ela, o corretor pode digitar a conta.
  let adAccounts: { id: string; name: string }[] = [];
  if (inspection.kind === "USER") {
    try {
      const res = await graphGet<{ data?: { account_id: string; name: string }[] }>("/me/adaccounts", token.trim(), {
        fields: "account_id,name",
        limit: "100",
      });
      adAccounts = (res.data ?? []).map((a) => ({ id: a.account_id, name: a.name }));
    } catch {
      adAccounts = [];
    }
  }

  return {
    kind: inspection.kind,
    ownerName: inspection.ownerName,
    adAccounts,
    pages: inspection.pages.map(({ id, name }) => ({ id, name })),
    selectedPageId: selected?.id ?? null,
    forms,
    formsError,
  };
}

/** Garante que o corretor pode usar a Área do Corretor (lido do banco a cada chamada). */
export async function hasPersonalAccess(brokerId: string): Promise<boolean> {
  const access = await prisma.brokerPersonalAccess.findUnique({ where: { brokerId } });
  if (!access?.enabled) return false;
  const broker = await prisma.broker.findUnique({ where: { id: brokerId }, include: { user: true } });
  return Boolean(broker && broker.status !== "INACTIVE" && broker.user.status === "ACTIVE");
}

/**
 * Etapa 2: salva a conexão do corretor. Valida de verdade, na Meta, o acesso à Página e a
 * leitura de leads de CADA formulário escolhido (ter conta de anúncios não garante isso).
 */
export async function connectBrokerMeta(params: {
  organizationId: string;
  brokerId: string;
  userId: string;
  token: string;
  pageId: string;
  formIds: string[];
  name?: string;
  adAccountId?: string | null;
  adAccountName?: string | null;
}) {
  const { organizationId, brokerId, userId, pageId } = params;
  const broker = await prisma.broker.findFirst({ where: { id: brokerId, organizationId } });
  if (!broker) throw new PersonalAreaError(404, "Corretor não encontrado.");
  if (!(await hasPersonalAccess(brokerId))) {
    throw new PersonalAreaError(403, "A Área do Corretor não está liberada para este corretor.");
  }
  const formIds = [...new Set(params.formIds.map((f) => f.trim()).filter(Boolean))];
  if (formIds.length === 0) throw new PersonalAreaError(422, "Selecione pelo menos um formulário de Lead Ads.");

  let inspection: TokenInspection;
  try {
    inspection = await inspectToken(params.token.trim());
  } catch (error) {
    throw new PersonalAreaError(422, friendlyMetaError(error));
  }
  const page = inspection.pages.find((p) => p.id === pageId);
  if (!page) throw new PersonalAreaError(422, "O token não dá acesso a esta Página.");

  // Conflitos: a Página não pode ser a da integração geral nem estar com outro corretor.
  const general = await prisma.metaIntegration.findFirst({ where: { pageId } });
  if (general) {
    throw new PersonalAreaError(
      409,
      "Esta Página já está conectada à integração geral da imobiliária. Use a Página própria do corretor."
    );
  }
  const existing = await prisma.brokerMetaConnection.findUnique({ where: { pageId } });
  if (existing && existing.isActive && existing.brokerId !== brokerId) {
    throw new PersonalAreaError(409, "Esta Página já está conectada à Área do Corretor de outro corretor.");
  }

  let availableForms: InspectedForm[] = [];
  try {
    availableForms = await listForms(page.id, page.pageToken);
  } catch {
    // Sem permissão para listar: ainda validamos cada formulário pelo id logo abaixo.
  }
  const formNames = new Map<string, string | null>();
  for (const formId of formIds) {
    try {
      const form = await graphGet<{ id: string; name?: string; page?: { id: string } }>(`/${formId}`, page.pageToken, {
        fields: "id,name,page",
      });
      if (form.page?.id && form.page.id !== page.id) {
        throw new PersonalAreaError(422, `O formulário ${formId} não pertence à Página selecionada.`);
      }
      // Teste real da permissão de leitura de leads (leads_retrieval) neste formulário.
      await graphGet(`/${formId}/leads`, page.pageToken, { fields: "id", limit: "1" });
      formNames.set(formId, form.name ?? availableForms.find((f) => f.id === formId)?.name ?? null);
    } catch (error) {
      if (error instanceof PersonalAreaError) throw error;
      throw new PersonalAreaError(422, `Não foi possível ler os leads do formulário ${formId}: ${friendlyMetaError(error)}`);
    }
  }

  const now = new Date();
  const data = {
    organizationId,
    brokerId,
    name: params.name?.trim() || `Meta — ${page.name}`,
    accountOwnerName: inspection.ownerName,
    pageName: page.name,
    adAccountId: params.adAccountId?.trim() || null,
    adAccountName: params.adAccountName?.trim() || null,
    accessTokenEncrypted: encryptSecret(page.pageToken),
    status: "ACTIVE",
    isActive: true,
    lastSyncError: null,
    createdByUserId: userId,
  };

  const connection = await prisma.$transaction(async (tx) => {
    const conn = existing
      ? await tx.brokerMetaConnection.update({ where: { id: existing.id }, data })
      : await tx.brokerMetaConnection.create({ data: { ...data, pageId } });

    // Formulários: os escolhidos ficam ativos; os demais da conexão são desativados (sem apagar).
    await tx.brokerMetaForm.updateMany({
      where: { connectionId: conn.id, formId: { notIn: formIds } },
      data: { isActive: false },
    });
    // Reconexão depois de "Desconectar" (ou Página que era de outro corretor): começa do zero,
    // sem importar o que entrou enquanto estava desligada. Já na reconexão por token vencido
    // o cursor é mantido, para recuperar os leads que chegaram nesse intervalo.
    if (existing && (!existing.isActive || existing.brokerId !== brokerId)) {
      await tx.brokerMetaForm.updateMany({ where: { connectionId: conn.id }, data: { syncCursor: now } });
    }
    for (const formId of formIds) {
      await tx.brokerMetaForm.upsert({
        where: { connectionId_formId: { connectionId: conn.id, formId } },
        // Só leads novos a partir da conexão (não importa o histórico antigo do formulário).
        create: { organizationId, connectionId: conn.id, formId, formName: formNames.get(formId), syncCursor: now },
        update: { isActive: true, formName: formNames.get(formId) ?? undefined },
      });
    }
    return conn;
  });

  log("connection_saved", { connectionId: connection.id, brokerId, pageId, forms: formIds.length });
  return connection;
}

export async function disconnectBrokerMeta(connectionId: string) {
  await prisma.brokerMetaConnection.update({
    where: { id: connectionId },
    data: { isActive: false, status: "DISCONNECTED" },
  });
  log("connection_disconnected", { connectionId });
}

/** Liga/desliga o acesso. Nada é apagado; ao reativar, a conexão volta de onde estava. */
export async function setBrokerPersonalAccess(params: {
  organizationId: string;
  brokerId: string;
  enabled: boolean;
  userId: string;
}) {
  const { organizationId, brokerId, enabled, userId } = params;
  const broker = await prisma.broker.findFirst({ where: { id: brokerId, organizationId } });
  if (!broker) throw new PersonalAreaError(404, "Corretor não encontrado.");
  const now = new Date();
  const previous = await prisma.brokerPersonalAccess.findUnique({ where: { brokerId } });

  const access = await prisma.brokerPersonalAccess.upsert({
    where: { brokerId },
    create: {
      organizationId,
      brokerId,
      enabled,
      enabledAt: enabled ? now : null,
      disabledAt: enabled ? null : now,
      updatedByUserId: userId,
    },
    update: {
      enabled,
      ...(enabled ? { enabledAt: now } : { disabledAt: now }),
      updatedByUserId: userId,
    },
  });

  // Reativação: leads gerados enquanto o acesso estava desligado NÃO são importados
  // (não houve autorização naquele período) — a consulta recomeça do momento da reativação.
  if (enabled && previous && !previous.enabled) {
    await prisma.brokerMetaForm.updateMany({
      where: { connection: { brokerId, organizationId } },
      data: { syncCursor: now },
    });
  }
  return access;
}

// ============================================================
// Recebimento (sincronização)
// ============================================================

/**
 * Grava UM lead vindo da Meta na carteira do dono da conexão. Devolve null se o lead já
 * existia (reenvio/repetição) — a unicidade no banco é a garantia final contra duplicidade.
 */
async function savePersonalLead(
  connection: { id: string; organizationId: string; brokerId: string; pageId: string; adAccountId: string | null },
  form: { formId: string; formName: string | null },
  raw: MetaPersonalLeadRaw
) {
  const already = await prisma.personalLead.findUnique({
    where: { organizationId_metaLeadId: { organizationId: connection.organizationId, metaLeadId: raw.id } },
    select: { id: true },
  });
  if (already) return null;

  const contact = extractPersonalContact(raw.field_data);
  try {
    return await prisma.$transaction(async (tx) => {
      const lead = await tx.personalLead.create({
        data: {
          organizationId: connection.organizationId,
          brokerId: connection.brokerId,
          connectionId: connection.id,
          sourceType: PERSONAL_SOURCE_TYPE,
          metaLeadId: raw.id,
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          platform: raw.platform ?? "facebook",
          pageId: connection.pageId,
          adAccountId: connection.adAccountId,
          campaignId: raw.campaign_id ?? null,
          campaignName: raw.campaign_name ?? null,
          adsetId: raw.adset_id ?? null,
          adsetName: raw.adset_name ?? null,
          adId: raw.ad_id ?? null,
          adName: raw.ad_name ?? null,
          formId: raw.form_id ?? form.formId,
          formName: form.formName,
          customFields: normalizePersonalFieldData(raw.field_data),
          rawData: raw as unknown as Prisma.InputJsonValue,
          createdAt: raw.created_time ? new Date(raw.created_time) : new Date(),
        },
      });
      await tx.personalLeadEvent.create({
        data: {
          organizationId: connection.organizationId,
          personalLeadId: lead.id,
          type: "RECEIVED",
          metadata: { metaLeadId: raw.id, formId: form.formId, campaignName: raw.campaign_name ?? null },
        },
      });
      return lead;
    });
  } catch (error) {
    // Duas sincronizações ao mesmo tempo: a outra já gravou este lead.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

export type SyncResult = { connectionId: string; skipped?: string; found: number; created: number; error?: string };

/** Sincroniza UMA conexão. Nunca lança: erro fica gravado na conexão e no log de sincronização. */
export async function syncBrokerMetaConnection(connectionId: string, trigger: "worker" | "manual" = "worker"): Promise<SyncResult> {
  const connection = await prisma.brokerMetaConnection.findUnique({
    where: { id: connectionId },
    include: { forms: { where: { isActive: true } } },
  });
  if (!connection || !connection.isActive) return { connectionId, skipped: "inactive", found: 0, created: 0 };
  if (!(await hasPersonalAccess(connection.brokerId))) return { connectionId, skipped: "access_disabled", found: 0, created: 0 };

  let found = 0;
  let created = 0;
  let lastLead: { id: string; name: string } | null = null;
  const createdLeads: { id: string; name: string }[] = [];

  try {
    const token = decryptSecret(connection.accessTokenEncrypted);
    for (const form of connection.forms) {
      const since = new Date((form.syncCursor ?? connection.createdAt).getTime() - SYNC_OVERLAP_MS);
      const filtering = JSON.stringify([
        { field: "time_created", operation: "GREATER_THAN", value: Math.floor(since.getTime() / 1000) },
      ]);
      let url: URL | null = new URL(`${GRAPH_BASE}/${form.formId}/leads`);
      url.searchParams.set("fields", LEAD_FIELDS);
      url.searchParams.set("filtering", filtering);
      url.searchParams.set("limit", "100");
      url.searchParams.set("access_token", token);

      let maxCreated = form.syncCursor?.getTime() ?? 0;
      for (let page = 0; url && page < SYNC_MAX_PAGES; page++) {
        const res: { data?: MetaPersonalLeadRaw[]; paging?: { next?: string } } = await graphGetUrl(url);
        for (const raw of res.data ?? []) {
          found += 1;
          const t = raw.created_time ? new Date(raw.created_time).getTime() : 0;
          if (t > maxCreated) maxCreated = t;
          const lead = await savePersonalLead(connection, { formId: form.formId, formName: form.formName }, raw);
          if (lead) {
            created += 1;
            lastLead = { id: lead.id, name: lead.name };
            createdLeads.push(lastLead);
          }
        }
        url = res.paging?.next ? new URL(res.paging.next) : null;
      }

      await prisma.brokerMetaForm.update({
        where: { id: form.id },
        data: { lastPolledAt: new Date(), ...(maxCreated > 0 ? { syncCursor: new Date(maxCreated) } : {}) },
      });
    }

    await prisma.brokerMetaConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncError: null,
        status: "ACTIVE",
        ...(created > 0 ? { lastLeadAt: new Date() } : {}),
      },
    });
    if (created > 0 || trigger === "manual") {
      await prisma.brokerMetaSyncLog.create({
        data: { organizationId: connection.organizationId, connectionId: connection.id, trigger, leadsFound: found, leadsCreated: created },
      });
    }
  } catch (error) {
    const message = friendlyMetaError(error);
    const needsReconnect = error instanceof MetaGraphError && error.isAuthError;
    await prisma.brokerMetaConnection.update({
      where: { id: connection.id },
      data: { lastSyncAt: new Date(), lastSyncError: message, status: needsReconnect ? "NEEDS_RECONNECT" : "ERROR" },
    });
    await prisma.brokerMetaSyncLog.create({
      data: { organizationId: connection.organizationId, connectionId: connection.id, trigger, leadsFound: found, leadsCreated: created, error: message },
    });
    log("sync_error", { connectionId, needsReconnect, error: message });
    // Leads já gravados antes do erro continuam válidos e são avisados abaixo.
    await notifyCreated(connection.brokerId, createdLeads);
    return { connectionId, found, created, error: message };
  }

  await notifyCreated(connection.brokerId, createdLeads);
  if (created > 0) log("sync_leads_created", { connectionId, created, lastLeadId: lastLead?.id });
  return { connectionId, found, created };
}

async function notifyCreated(brokerId: string, leads: { id: string; name: string }[]) {
  if (leads.length === 0) return;
  const body = leads.length === 1 ? `${leads[0].name} chegou pela sua campanha particular.` : `${leads.length} leads novos chegaram pelas suas campanhas particulares.`;
  await sendPersonalAreaPush(brokerId, {
    title: "Novo lead particular",
    body,
    tag: leads.length === 1 ? `personal-lead-${leads[0].id}` : "personal-leads",
  });
}

/**
 * Sincroniza todas as conexões ativas (worker). Conexões que precisam de reconexão ficam de
 * fora até o corretor colar um token novo — evita bater na Meta com token morto.
 */
export async function syncAllBrokerMetaConnections(limit = 200): Promise<SyncResult[]> {
  const connections = await prisma.brokerMetaConnection.findMany({
    where: {
      isActive: true,
      status: { not: "NEEDS_RECONNECT" },
      broker: { personalAccess: { enabled: true } },
    },
    select: { id: true },
    orderBy: { lastSyncAt: { sort: "asc", nulls: "first" } },
    take: limit,
  });
  const results: SyncResult[] = [];
  for (const c of connections) {
    try {
      results.push(await syncBrokerMetaConnection(c.id, "worker"));
    } catch (error) {
      log("sync_fatal", { connectionId: c.id, error: String(error) });
    }
  }
  return results;
}

// ============================================================
// Carteira particular: etapas, notas e lembretes
// ============================================================

export async function updatePersonalLeadStatus(params: {
  organizationId: string;
  leadId: string;
  userId: string;
  status: PersonalLeadStatus;
  reminderPeriod?: LostReturnPeriod;
}) {
  const { organizationId, leadId, userId, status } = params;
  const lead = await prisma.personalLead.findFirst({ where: { id: leadId, organizationId } });
  if (!lead) throw new PersonalAreaError(404, "Lead não encontrado.");

  const now = new Date();
  let remarketingNotifyAt: Date | null = null;
  if (status === LeadStatus.REMARKETING) {
    if (!params.reminderPeriod) throw new PersonalAreaError(422, "Escolha quando reenviar o lembrete.");
    try {
      remarketingNotifyAt = computeLostReturnAt(now, params.reminderPeriod);
    } catch (error) {
      throw new PersonalAreaError(422, (error as Error).message);
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.personalLead.update({
      where: { id: lead.id },
      data: {
        status,
        remarketingNotifyAt,
        ...(lead.status === LeadStatus.NEW && status !== LeadStatus.NEW && !lead.firstContactAt ? { firstContactAt: now } : {}),
        ...(status === LeadStatus.CONVERTED && !lead.convertedAt ? { convertedAt: now } : {}),
      },
    });
    await tx.personalLeadEvent.create({
      data: {
        organizationId,
        personalLeadId: lead.id,
        userId,
        type: "STATUS_CHANGED",
        metadata: { from: lead.status, to: status, ...(remarketingNotifyAt ? { reminderAt: remarketingNotifyAt.toISOString() } : {}) },
      },
    });
    return result;
  });
  return updated;
}

export async function addPersonalLeadNote(params: { organizationId: string; leadId: string; userId: string; content: string }) {
  const content = params.content.trim();
  if (!content) throw new PersonalAreaError(422, "A nota não pode ficar vazia.");
  if (content.length > 5000) throw new PersonalAreaError(422, "A nota pode ter no máximo 5000 caracteres.");
  const lead = await prisma.personalLead.findFirst({ where: { id: params.leadId, organizationId: params.organizationId } });
  if (!lead) throw new PersonalAreaError(404, "Lead não encontrado.");

  return prisma.$transaction(async (tx) => {
    const note = await tx.personalLeadNote.create({
      data: { organizationId: params.organizationId, personalLeadId: lead.id, authorUserId: params.userId, content },
    });
    await tx.personalLeadEvent.create({
      data: { organizationId: params.organizationId, personalLeadId: lead.id, userId: params.userId, type: "NOTE_ADDED", metadata: {} },
    });
    return note;
  });
}

/** Lembretes de Remarketing vencidos da carteira particular (worker). Respeita o horário de silêncio. */
export async function sendDuePersonalReminders(limit = 50, now = new Date()): Promise<number> {
  if (isQuietHours(now)) return 0;
  const due = await prisma.personalLead.findMany({
    where: { status: LeadStatus.REMARKETING, remarketingNotifyAt: { lte: now } },
    orderBy: { remarketingNotifyAt: "asc" },
    take: limit,
    select: { id: true, organizationId: true, brokerId: true, name: true, remarketingNotifyAt: true },
  });

  let sent = 0;
  for (const lead of due) {
    // "Pega" o lembrete de forma atômica: se outra execução já pegou, não envia de novo.
    const claimed = await prisma.personalLead.updateMany({
      where: { id: lead.id, status: LeadStatus.REMARKETING, remarketingNotifyAt: lead.remarketingNotifyAt },
      data: { remarketingNotifyAt: null },
    });
    if (claimed.count !== 1) continue;
    await prisma.personalLeadEvent.create({
      data: { organizationId: lead.organizationId, personalLeadId: lead.id, type: "REMINDER_SENT", metadata: {} },
    });
    await sendPersonalAreaPush(lead.brokerId, {
      title: "Lembrete de remarketing",
      body: `Hora de retomar o contato com ${lead.name} (carteira particular).`,
      tag: `personal-lead-${lead.id}`,
    });
    sent += 1;
  }
  return sent;
}

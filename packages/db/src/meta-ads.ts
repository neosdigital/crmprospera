import { prisma } from "./index";
import { decryptSecret } from "./crypto";
import { brasiliaHour } from "./quiet-hours";
import { notifyOrgAdmins } from "./push";

/**
 * Central Meta Ads — acompanhamento de UMA conta de anúncio por organização (saldo,
 * veiculação, leads), lida com o token de usuário do sistema da BM do cliente.
 *
 * Mesmas regras do monitor do Neos Dashboard (railway-backend/meta-monitor.js):
 * - saldo pelo gasto real: maior média diária entre 3 e 7 dias (sem histórico, orçamento diário)
 * - etapas: até 3 dias "Saldo baixo", até 1 dia "Saldo acabando", zerou "Sem saldo"
 * - conta parada (sem saldo / pagamento pendente): uma notificação que se repete de 3 em 3h
 * - campanha ativa sem gasto: só a partir das 10h
 * - resumo diário às 8h; aviso 5 dias antes do acesso do token vencer
 * A tela (GET /api/meta-ads) e o worker usam as mesmas funções daqui.
 */

const GRAPH = "https://graph.facebook.com/v21.0";
const INS = "spend,impressions,reach,clicks,actions";
const ACCOUNT_STATUS: Record<number, string> = {
  1: "Ativa", 2: "Desativada", 3: "Pagamento pendente", 7: "Em análise", 8: "Liquidação pendente",
  9: "Período de carência", 100: "Encerrando", 101: "Encerrada",
};
export const META_ADS_PRESETS = [
  { id: "last_7d", label: "Últimos 7 dias" },
  { id: "last_14d", label: "Últimos 14 dias" },
  { id: "last_30d", label: "Últimos 30 dias" },
  { id: "this_month", label: "Este mês" },
  { id: "last_month", label: "Mês anterior" },
] as const;
export type MetaAdsPreset = (typeof META_ADS_PRESETS)[number]["id"];

const LOW_WARN_DAYS = 3;
const LOW_URGENT_DAYS = 1;
const IDLE_FROM_HOUR = 10;
const DAILY_FROM_HOUR = 8;
const DAILY_UNTIL_HOUR = 11;
const STOPPED_REMIND_MS = 3 * 60 * 60 * 1000;
const LOW_REMIND_MS = 24 * 60 * 60 * 1000;
const TOKEN_WARN_DAYS = 5;

type GraphInsight = { spend?: string; impressions?: string; reach?: string; clicks?: string; actions?: { action_type: string; value: string }[] };
type GraphEdge<T> = { data?: T[] };
type GraphCampaign = { id: string; name: string; effective_status: string; daily_budget?: string; lifetime_budget?: string; hoje?: GraphEdge<GraphInsight>; periodo?: GraphEdge<GraphInsight> };
type GraphAccount = {
  id: string; name: string; account_status: number; balance?: string; amount_spent?: string; spend_cap?: string;
  is_prepay_account?: boolean; funding_source_details?: { display_string?: string };
  hoje?: GraphEdge<GraphInsight>; ontem?: GraphEdge<GraphInsight>; periodo?: GraphEdge<GraphInsight>;
  tresdias?: GraphEdge<GraphInsight>; setedias?: GraphEdge<GraphInsight>;
  campaigns?: GraphEdge<{ effective_status: string; daily_budget?: string }>;
};

async function graph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ access_token: token, ...params });
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const data = (await res.json()) as T & { error?: { message: string; error_user_msg?: string } };
  if (data.error) throw new Error(data.error.error_user_msg || data.error.message);
  return data as T;
}

export function normalizeAdAccountId(raw: string): string {
  const digits = raw.trim().replace(/^act_/, "").replace(/\D/g, "");
  return digits ? `act_${digits}` : "";
}

export type Metrics = { spend: number; impressions: number; reach: number; clicks: number; leads: number };
function metrics(ins?: GraphEdge<GraphInsight>): Metrics {
  const i = ins?.data?.[0] ?? {};
  const act = (t: string) => Number(i.actions?.find((a) => a.action_type === t)?.value) || 0;
  return {
    spend: Number(i.spend) || 0,
    impressions: Number(i.impressions) || 0,
    reach: Number(i.reach) || 0,
    clicks: Number(i.clicks) || 0,
    leads: act("lead") || act("onsite_conversion.lead_grouped"),
  };
}

/** "Saldo disponível (R$1.234,56 BRL)" → 1234.56 */
function parseMetaMoney(s?: string): number | null {
  const m = String(s ?? "").match(/([\d.]+,\d{2})/);
  return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : null;
}

export function daysLabel(d: number): string {
  if (d < 1) return "menos de 1 dia";
  const n = Math.floor(d);
  return `${n} ${n === 1 ? "dia" : "dias"}`;
}
const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

export type AlertKind = "payment" | "nofunds" | "low1" | "low3" | "idle";
export type AccountAlert = { kind: AlertKind; group: "payment" | "funds" | "idle"; stopped: boolean; title: string; body: string };

export type AccountSnapshot = {
  id: string;
  name: string;
  statusLabel: string;
  delivery: "running" | "idle" | "stopped" | "problem";
  deliveryLabel: string;
  funds: { kind: "prepaid"; balance: number } | { kind: "card"; owed: number; capLeft: number | null };
  burnRate: number;
  dailyBudget: number;
  daysLeft: number | null;
  activeCampaigns: number;
  pausedCampaigns: number;
  today: Metrics;
  yesterday: Metrics;
  period: Metrics;
  alert: AccountAlert | null;
};

function accountFields(preset: string) {
  return [
    "name,account_status,balance,amount_spent,spend_cap,is_prepay_account,funding_source_details",
    `insights.date_preset(today).as(hoje){${INS}}`,
    `insights.date_preset(yesterday).as(ontem){${INS}}`,
    `insights.date_preset(${preset}).as(periodo){${INS}}`,
    "insights.date_preset(last_3d).as(tresdias){spend}",
    "insights.date_preset(last_7d).as(setedias){spend}",
    "campaigns.limit(200){effective_status,daily_budget}",
  ].join(",");
}

function buildSnapshot(a: GraphAccount): AccountSnapshot {
  const camps = a.campaigns?.data ?? [];
  const active = camps.filter((c) => c.effective_status === "ACTIVE");
  const paused = camps.filter((c) => /PAUSED/.test(c.effective_status));
  const dailyBudget = active.reduce((s, c) => s + (Number(c.daily_budget) || 0) / 100, 0);
  const burnRate = Math.max(metrics(a.tresdias).spend / 3, metrics(a.setedias).spend / 7) || dailyBudget;
  const today = metrics(a.hoje);
  const funds: AccountSnapshot["funds"] = a.is_prepay_account
    ? { kind: "prepaid", balance: parseMetaMoney(a.funding_source_details?.display_string) ?? 0 }
    : {
        kind: "card",
        owed: (Number(a.balance) || 0) / 100,
        capLeft: Number(a.spend_cap) > 0 ? Math.max(0, (Number(a.spend_cap) - (Number(a.amount_spent) || 0)) / 100) : null,
      };
  const daysLeft = funds.kind === "prepaid" && funds.balance > 0 && burnRate > 0 ? funds.balance / burnRate : null;
  const statusLabel = ACCOUNT_STATUS[a.account_status] ?? "Com problema";

  let delivery: AccountSnapshot["delivery"] = "stopped";
  let deliveryLabel = "Parada";
  if (a.account_status !== 1) { delivery = "problem"; deliveryLabel = statusLabel; }
  else if (active.length && today.spend > 0) { delivery = "running"; deliveryLabel = "Rodando"; }
  else if (active.length && funds.kind === "prepaid" && funds.balance <= 0) { delivery = "problem"; deliveryLabel = "Sem saldo"; }
  else if (active.length) { delivery = "idle"; deliveryLabel = "Ativa, sem gasto hoje"; }

  const n = active.length, s = n > 1 ? "s" : "";
  let alert: AccountAlert | null = null;
  if (n > 0) {
    if (a.account_status !== 1) {
      alert = { kind: "payment", group: "payment", stopped: true, title: statusLabel, body: `${a.name} · ${n} campanha${s} parada${s}` };
    } else if (funds.kind === "prepaid" && funds.balance <= 0) {
      alert = { kind: "nofunds", group: "funds", stopped: true, title: "Sem saldo", body: `${a.name} · ${n} campanha${s} parada${s}` };
    } else if (funds.kind === "prepaid" && (daysLeft != null ? daysLeft <= LOW_WARN_DAYS : funds.balance < 50)) {
      const urgent = daysLeft != null ? daysLeft <= LOW_URGENT_DAYS : funds.balance < 20;
      alert = {
        kind: urgent ? "low1" : "low3", group: "funds", stopped: false,
        title: urgent ? "Saldo acabando" : "Saldo baixo",
        body: `${a.name} · ${brl(funds.balance)}${daysLeft != null ? ` · dura ${daysLabel(daysLeft)}` : ""}`,
      };
    } else if (today.spend === 0 && brasiliaHour() >= IDLE_FROM_HOUR) {
      alert = { kind: "idle", group: "idle", stopped: false, title: "Sem gasto hoje", body: `${a.name} · ${n} campanha${s} ativa${s} sem veicular` };
    }
  }

  return {
    id: a.id, name: a.name, statusLabel, delivery, deliveryLabel, funds, burnRate, dailyBudget, daysLeft,
    activeCampaigns: active.length, pausedCampaigns: paused.length,
    today, yesterday: metrics(a.ontem), period: metrics(a.periodo), alert,
  };
}

export async function fetchAccountSnapshot(token: string, adAccountId: string, preset: string = "last_7d"): Promise<AccountSnapshot> {
  return buildSnapshot(await graph<GraphAccount>(adAccountId, token, { fields: accountFields(preset) }));
}

export type CampaignRow = {
  id: string; name: string; status: string; dailyBudget: number | null; lifetimeBudget: number | null;
  today: Metrics; period: Metrics;
};

/** Campanhas ativas ou que gastaram no período (as pausadas sem gasto ficam de fora). */
export async function fetchCampaigns(token: string, adAccountId: string, preset: string = "last_7d"): Promise<{ rows: CampaignRow[]; hidden: number }> {
  const fields = `name,effective_status,daily_budget,lifetime_budget,insights.date_preset(today).as(hoje){${INS}},insights.date_preset(${preset}).as(periodo){${INS}}`;
  const all: CampaignRow[] = [];
  let page = await graph<{ data: GraphCampaign[]; paging?: { next?: string } }>(`${adAccountId}/campaigns`, token, { fields, limit: "100" });
  for (;;) {
    for (const c of page.data ?? []) {
      all.push({
        id: c.id, name: c.name, status: c.effective_status,
        dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
        lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
        today: metrics(c.hoje), period: metrics(c.periodo),
      });
    }
    if (!page.paging?.next || all.length >= 500) break;
    page = (await (await fetch(page.paging.next)).json()) as typeof page;
  }
  const rows = all
    .filter((c) => c.status === "ACTIVE" || c.today.spend > 0 || c.period.spend > 0)
    .sort((x, y) => Number(y.status === "ACTIVE") - Number(x.status === "ACTIVE") || y.today.spend - x.today.spend || y.period.spend - x.period.spend);
  return { rows, hidden: all.length - rows.length };
}

/** Valida o token e a conta antes de salvar: devolve nome da conta e os dois prazos do token. */
export async function inspectAdAccountToken(token: string, adAccountId: string) {
  const account = await graph<{ id: string; name: string }>(adAccountId, token, { fields: "id,name" });
  const dbg = await graph<{ data?: { expires_at?: number; data_access_expires_at?: number; type?: string } }>("debug_token", token, { input_token: token })
    .then((d) => d.data ?? {})
    .catch(() => ({} as { expires_at?: number; data_access_expires_at?: number; type?: string }));
  const toDate = (x?: number) => (x && x > 0 ? new Date(x * 1000) : null);
  return { name: account.name, tokenType: dbg.type ?? null, tokenExpiresAt: toDate(dbg.expires_at), dataAccessExpiresAt: toDate(dbg.data_access_expires_at) };
}

// ============================================================
// MONITOR (worker) — push para donos/admins, sem repetir
// ============================================================

type AlertState = {
  account?: { kind: AlertKind; notifiedAt: string };
  token?: { notifiedAt: string };
  stoppedRemindedAt?: string;
  dailySummaryDate?: string;
};

const todayBR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const URL_PATH = "/meta-ads";

/**
 * Uma rodada para todas as organizações com conta conectada. Idempotente e seguro de
 * repetir: o que já foi avisado fica em alertState. Nunca lança — erro de uma organização
 * fica em lastError e não impede as outras.
 */
export async function runAdAccountMonitor(): Promise<void> {
  const monitors = await prisma.adAccountMonitor.findMany({ where: { isActive: true } });
  for (const m of monitors) {
    const state = (m.alertState ?? {}) as AlertState;
    const now = Date.now();
    try {
      const token = decryptSecret(m.accessTokenEncrypted);

      /* prazo do token: validade ou acesso aos dados, o que vencer primeiro */
      const deadlines = [m.tokenExpiresAt, m.dataAccessExpiresAt].filter((d): d is Date => Boolean(d)).map((d) => d.getTime());
      const deadline = deadlines.length ? Math.min(...deadlines) : null;
      const tokenDays = deadline != null ? (deadline - now) / 86400000 : null;
      if (tokenDays != null && tokenDays <= TOKEN_WARN_DAYS) {
        if (!state.token || now - new Date(state.token.notifiedAt).getTime() > LOW_REMIND_MS) {
          const sent = await notifyOrgAdmins(m.organizationId, {
            title: "Token do Meta",
            body: tokenDays <= 0 ? "Acesso expirado. Gere um token novo e conecte em Meta Ads." : `Acesso vence em ${daysLabel(tokenDays)}. Gere um token novo em Meta Ads.`,
            url: URL_PATH, tag: "meta-ads-token",
          });
          if (sent) state.token = { notifiedAt: new Date().toISOString() };
        }
        if (tokenDays <= 0) {
          await prisma.adAccountMonitor.update({ where: { id: m.id }, data: { alertState: state, lastCheckAt: new Date(), lastError: "Token sem acesso aos dados" } });
          continue;
        }
      } else {
        delete state.token;
      }

      const snap = await fetchAccountSnapshot(token, m.adAccountId);
      const al = snap.alert;
      const prev = state.account;

      if (!al) {
        delete state.account;
      } else if (!prev || prev.kind !== al.kind || (!al.stopped && al.kind !== "idle" && now - new Date(prev.notifiedAt).getTime() > LOW_REMIND_MS)) {
        /* problema novo, mudou de etapa, ou saldo baixo que continua (1x por dia) */
        /* no horário de silêncio nada sai — fica para a primeira rodada depois das 7h */
        if (await notifyOrgAdmins(m.organizationId, { title: al.title, body: al.body, url: URL_PATH, tag: al.stopped ? "meta-ads-paradas" : "meta-ads-conta" })) {
          state.account = { kind: al.kind, notifiedAt: new Date().toISOString() };
          if (al.stopped) state.stoppedRemindedAt = new Date().toISOString();
        }
      } else if (al.stopped && now - new Date(state.stoppedRemindedAt ?? prev.notifiedAt).getTime() >= STOPPED_REMIND_MS) {
        /* conta parada: relembra de 3 em 3h, substituindo a notificação anterior */
        if (await notifyOrgAdmins(m.organizationId, { title: al.title, body: al.body, url: URL_PATH, tag: "meta-ads-paradas" })) {
          state.stoppedRemindedAt = new Date().toISOString();
        }
      }

      /* resumo diário às 8h */
      const h = brasiliaHour();
      if (h >= DAILY_FROM_HOUR && h < DAILY_UNTIL_HOUR && state.dailySummaryDate !== todayBR()) {
        const status = al ? `${al.title}${al.kind === "low1" || al.kind === "low3" ? ` (${snap.daysLeft != null ? `dura ${daysLabel(snap.daysLeft)}` : brl(snap.funds.kind === "prepaid" ? snap.funds.balance : 0)})` : ""}` : "Conta em dia";
        const y = snap.yesterday;
        const sent = await notifyOrgAdmins(m.organizationId, {
          title: "Resumo de hoje",
          body: `${status} · Ontem: ${brl(y.spend)} e ${y.leads} lead${y.leads !== 1 ? "s" : ""}`,
          url: URL_PATH, tag: "meta-ads-resumo",
        });
        if (sent) state.dailySummaryDate = todayBR();
      }

      await prisma.adAccountMonitor.update({
        where: { id: m.id },
        data: { alertState: state, lastCheckAt: new Date(), lastError: null, adAccountName: snap.name },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ ts: new Date().toISOString(), scope: "META_ADS", event: "monitor_error", organizationId: m.organizationId, error: message }));
      await prisma.adAccountMonitor.update({ where: { id: m.id }, data: { lastCheckAt: new Date(), lastError: message } }).catch(() => {});
    }
  }
}

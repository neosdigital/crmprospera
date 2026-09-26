import webpush, { WebPushError } from "web-push";
import { AuditAction } from "@prisma/client";
import { prisma } from "./index";
import { isQuietHours } from "./quiet-hours";

/**
 * Web Push (VAPID) — mora no pacote compartilhado, e não só no app, porque a roleta também
 * gira fora do app: quando o prazo de um corretor vence, quem passa o lead para o próximo é
 * o worker (Railway), via expireAndRotate. Assim o aviso "sua vez" sai de qualquer processo
 * que crie uma atribuição. Os dois (app na Vercel e worker no Railway) precisam das mesmas
 * variáveis VAPID_* configuradas.
 *
 * Todo aviso de vez grava o resultado no audit_log (PUSH_SENT / PUSH_FAILED, entityId = id da
 * tentativa). É isso que alimenta o alerta de "notificações com problema" do painel do dono
 * (ver notification-health.ts) — se um processo parar de notificar (sem chaves, código
 * antigo, aparelho descadastrado), o dono fica sabendo em minutos, não pelos corretores.
 */

/** Qual processo está rodando ("worker" no Railway, "app" na Vercel) — vai no registro de cada envio. */
function processName() {
  return process.env.CRM_PROCESS_NAME ?? "app";
}

export function isPushConfigured(): boolean {
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  return Boolean(VAPID_SUBJECT && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!isPushConfigured()) {
    console.error(`[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT ausentes no processo "${processName()}" — push desativado.`);
    return false;
  }
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  webpush.setVapidDetails(VAPID_SUBJECT!, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
  configured = true;
  return true;
}

function sourceLabel(source: string): string {
  switch (source) {
    case "meta_ads":
      return "via Meta Ads";
    case "manual":
      return "via cadastro manual";
    default:
      return `via ${source}`;
  }
}

type PushPayload = {
  title: string;
  body: string;
  url: string;
  icon?: string;
  badge?: string;
  tag?: string;
};

type SendOptions = {
  /** Segundos que o serviço de push guarda a mensagem se o aparelho estiver offline. */
  ttlSeconds?: number;
};

/**
 * Tag da notificação de "sua vez" de um lead. Mesma tag a cada volta da roleta: no aparelho
 * do corretor, a notificação nova SUBSTITUI a anterior desse mesmo lead (e o sw.js usa
 * renotify: true, então ela toca/vibra de novo em vez de trocar em silêncio).
 */
function turnTag(leadId: string) {
  return `lead-turn-${leadId}`;
}

/**
 * Envia um payload para UMA inscrição e diz se o serviço de push aceitou. Nunca lança:
 * erros de subscription morta (404/410) apagam a linha; qualquer outro erro (rede,
 * subscription temporariamente inválida) só atualiza lastError/lastErrorAt.
 *
 * `urgency: "high"` é essencial: sem isso o Android (modo soneca) pode segurar a notificação
 * até o celular ser desbloqueado — e o corretor perde o prazo da roleta.
 */
async function sendToSubscription(
  subscription: { id: string; endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
  options: SendOptions = {}
): Promise<{ ok: boolean; error?: string }> {
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
      { urgency: "high", TTL: options.ttlSeconds ?? 24 * 60 * 60 }
    );
    await prisma.pushSubscription.update({
      where: { id: subscription.id },
      data: { lastSuccessAt: new Date(), lastError: null, lastErrorAt: null },
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
      // Inscrição não existe mais no navegador (desinstalou, limpou dados, etc.) — remove.
      await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => {});
      return { ok: false, error: "inscrição expirada (removida)" };
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[push] falha ao enviar notificação", { subscriptionId: subscription.id, error: message });
    await prisma.pushSubscription
      .update({ where: { id: subscription.id }, data: { lastError: message, lastErrorAt: new Date() } })
      .catch(() => {});
    return { ok: false, error: message };
  }
}

type BrokerSendResult =
  | { outcome: "sent"; devices: number; delivered: number }
  | { outcome: "no_devices" | "all_failed" | "broker_inactive"; devices: number; delivered: 0; errors?: string[] };

/** Manda o payload para todos os aparelhos inscritos de UM corretor. */
async function sendToBroker(brokerId: string, payload: PushPayload, options: SendOptions = {}): Promise<BrokerSendResult> {
  const broker = await prisma.broker.findUnique({
    where: { id: brokerId },
    include: { user: { include: { pushSubscriptions: true } } },
  });
  if (!broker || broker.user.status !== "ACTIVE") return { outcome: "broker_inactive", devices: 0, delivered: 0 };

  const subs = broker.user.pushSubscriptions;
  if (subs.length === 0) return { outcome: "no_devices", devices: 0, delivered: 0 };

  const results = await Promise.all(subs.map((sub) => sendToSubscription(sub, payload, options)));
  const delivered = results.filter((r) => r.ok).length;
  if (delivered === 0) {
    return { outcome: "all_failed", devices: subs.length, delivered: 0, errors: results.map((r) => r.error ?? "?") };
  }
  return { outcome: "sent", devices: subs.length, delivered };
}

/**
 * Notifica os DONOS/ADMINS da organização sobre um lead novo. Corretores NÃO recebem este
 * aviso: cada corretor só é notificado quando o lead cai na vez dele (notifyBrokerTurnPush),
 * para nenhum corretor receber aviso de lead que está na vez de outro.
 * Nunca lança. No horário de silêncio (23h–07h) não envia nada.
 */
export async function notifyNewLead(lead: {
  id: string;
  organizationId: string;
  name: string;
  source: string;
}): Promise<void> {
  if (isQuietHours()) {
    console.info("[push] horário de silêncio — notificação não enviada", { leadId: lead.id });
    return;
  }
  if (!ensureConfigured()) return;

  try {
    const users = await prisma.user.findMany({
      where: {
        organizationId: lead.organizationId,
        status: "ACTIVE",
        role: { in: ["OWNER", "ADMIN"] },
      },
      include: { pushSubscriptions: true },
    });

    const payload: PushPayload = {
      title: "Novo lead!",
      body: `${lead.name} - ${sourceLabel(lead.source)}`,
      url: `/leads/${lead.id}`,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: `lead-${lead.id}`,
    };

    await Promise.allSettled(
      users.flatMap((user) => user.pushSubscriptions.map((sub) => sendToSubscription(sub, payload)))
    );
  } catch (error) {
    console.error("[push] falha ao notificar novo lead", { leadId: lead.id, error: String(error) });
  }
}

/**
 * Avisa SOMENTE o corretor que está na vez de um lead na roleta — chamado a cada nova
 * tentativa (lead novo, prazo do anterior venceu, volta completa, devolvido para a roleta).
 * Na primeira vez que o corretor vê o lead: "Novo lead na sua vez"; nas voltas seguintes:
 * "está na sua vez na roleta novamente". A notificação substitui a anterior do mesmo lead
 * (ver turnTag). Nunca lança. No horário de silêncio (23h–07h) não envia nada (e não registra:
 * silêncio é intencional, não falha).
 *
 * Fora do silêncio, SEMPRE grava o resultado no audit_log (PUSH_SENT ou PUSH_FAILED com o
 * motivo) — inclusive quando o processo está sem as chaves VAPID, que é exatamente o caso
 * que precisa aparecer no alerta do dono.
 */
export async function notifyBrokerTurnPush(params: {
  organizationId: string;
  assignmentId: string;
  leadId: string;
  leadName: string;
  brokerId: string;
  timeoutMinutes: number;
  isReturning: boolean;
}): Promise<void> {
  if (isQuietHours()) {
    console.info("[push] horário de silêncio — notificação não enviada", { leadId: params.leadId });
    return;
  }

  let result: BrokerSendResult | { outcome: "not_configured" | "error"; devices: 0; delivered: 0; errors?: string[] };
  if (!ensureConfigured()) {
    result = { outcome: "not_configured", devices: 0, delivered: 0 };
  } else {
    try {
      result = await sendToBroker(
        params.brokerId,
        {
          title: params.isReturning ? "Sua vez na roleta novamente" : "Novo lead na sua vez!",
          body: params.isReturning
            ? `O lead ${params.leadName} está na sua vez na roleta novamente. Você tem ${params.timeoutMinutes} min para entrar em contato.`
            : `O lead ${params.leadName} está na sua vez na roleta. Você tem ${params.timeoutMinutes} min para entrar em contato.`,
          url: "/broker/dashboard",
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: turnTag(params.leadId),
        },
        // Depois que o prazo vence o aviso não serve mais — não adianta entregar atrasado.
        { ttlSeconds: Math.max(60, params.timeoutMinutes * 60) }
      );
    } catch (error) {
      result = { outcome: "error", devices: 0, delivered: 0, errors: [String(error)] };
    }
  }

  await prisma.auditLog
    .create({
      data: {
        organizationId: params.organizationId,
        leadId: params.leadId,
        action: result.outcome === "sent" ? AuditAction.PUSH_SENT : AuditAction.PUSH_FAILED,
        entityType: "push_turn",
        entityId: params.assignmentId,
        metadata: {
          brokerId: params.brokerId,
          outcome: result.outcome,
          devices: result.devices,
          delivered: result.delivered,
          process: processName(),
          ...("errors" in result && result.errors ? { errors: result.errors.slice(0, 5) } : {}),
        },
      },
    })
    .catch((error) => console.error("[push] falha ao registrar resultado do aviso de vez", String(error)));

  if (result.outcome !== "sent") {
    console.error("[push] aviso de vez NÃO entregue", { assignmentId: params.assignmentId, outcome: result.outcome });
  }
}

/**
 * Avisa SÓ o corretor que recebeu um lead direcionado manualmente pelo dono/admin (sem
 * roleta). Nunca lança e respeita o horário de silêncio.
 */
export async function notifyLeadAssignedToBroker(lead: { id: string; name: string }, brokerId: string): Promise<void> {
  if (isQuietHours()) {
    console.info("[push] horário de silêncio — notificação não enviada", { leadId: lead.id });
    return;
  }
  if (!ensureConfigured()) return;

  try {
    await sendToBroker(brokerId, {
      title: "Lead direcionado para você",
      body: `${lead.name} foi adicionado à sua carteira.`,
      url: "/broker/wallet",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: turnTag(lead.id),
    });
  } catch (error) {
    console.error("[push] falha ao notificar lead direcionado", { leadId: lead.id, error: String(error) });
  }
}

/** Usado pelo botão "Enviar notificação de teste" (só OWNER/ADMIN) — manda só pro próprio usuário. */
export async function sendTestPush(userId: string): Promise<{ sent: number }> {
  if (!ensureConfigured()) throw new Error("Push não configurado no servidor (faltam as chaves VAPID).");

  const user = await prisma.user.findUnique({ where: { id: userId }, include: { pushSubscriptions: true } });
  if (!user) throw new Error("Usuário não encontrado.");
  if (user.pushSubscriptions.length === 0) {
    throw new Error("Nenhum dispositivo inscrito para notificações neste usuário.");
  }

  const payload: PushPayload = {
    title: "Notificação de teste",
    body: "Se você está vendo isso, as notificações push estão funcionando! 🎉",
    url: user.role === "BROKER" ? "/broker/dashboard" : "/dashboard",
    tag: "teste",
  };

  await Promise.allSettled(user.pushSubscriptions.map((sub) => sendToSubscription(sub, payload)));
  return { sent: user.pushSubscriptions.length };
}

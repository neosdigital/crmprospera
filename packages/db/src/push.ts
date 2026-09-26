import webpush, { WebPushError } from "web-push";
import { prisma } from "./index";
import { isQuietHours } from "./quiet-hours";

/**
 * Web Push (VAPID) — mora no pacote compartilhado, e não só no app, porque a roleta também
 * gira fora do app: quando o prazo de um corretor vence, quem passa o lead para o próximo é
 * o worker (Railway), via expireAndRotate. Assim o aviso "sua vez" sai de qualquer processo
 * que crie uma atribuição. Os dois (app na Vercel e worker no Railway) precisam das mesmas
 * variáveis VAPID_* configuradas.
 */

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error("[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT ausentes — push desativado.");
    return false;
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
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

/**
 * Tag da notificação de "sua vez" de um lead. Mesma tag a cada volta da roleta: no aparelho
 * do corretor, a notificação nova SUBSTITUI a anterior desse mesmo lead (e o sw.js usa
 * renotify: true, então ela toca/vibra de novo em vez de trocar em silêncio).
 */
function turnTag(leadId: string) {
  return `lead-turn-${leadId}`;
}

/**
 * Envia um payload para UMA inscrição. Nunca lança: erros de subscription morta (404/410)
 * apagam a linha; qualquer outro erro (rede, subscription temporariamente inválida) só
 * atualiza lastError/lastErrorAt pra dar visibilidade sem derrubar o restante do envio.
 */
async function sendToSubscription(
  subscription: { id: string; endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
) {
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload)
    );
    await prisma.pushSubscription.update({
      where: { id: subscription.id },
      data: { lastSuccessAt: new Date(), lastError: null, lastErrorAt: null },
    });
  } catch (error) {
    if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
      // Inscrição não existe mais no navegador (desinstalou, limpou dados, etc.) — remove.
      await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => {});
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[push] falha ao enviar notificação", { subscriptionId: subscription.id, error: message });
    await prisma.pushSubscription
      .update({ where: { id: subscription.id }, data: { lastError: message, lastErrorAt: new Date() } })
      .catch(() => {});
  }
}

/** Manda o payload para todos os aparelhos inscritos de UM corretor (se o usuário dele estiver ativo). */
async function sendToBroker(brokerId: string, payload: PushPayload) {
  const broker = await prisma.broker.findUnique({
    where: { id: brokerId },
    include: { user: { include: { pushSubscriptions: true } } },
  });
  if (!broker || broker.user.status !== "ACTIVE") return;
  await Promise.allSettled(broker.user.pushSubscriptions.map((sub) => sendToSubscription(sub, payload)));
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
 * (ver turnTag). Nunca lança. No horário de silêncio (23h–07h) não envia nada.
 */
export async function notifyBrokerTurnPush(params: {
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
  if (!ensureConfigured()) return;

  try {
    await sendToBroker(params.brokerId, {
      title: params.isReturning ? "Sua vez na roleta novamente" : "Novo lead na sua vez!",
      body: params.isReturning
        ? `O lead ${params.leadName} está na sua vez na roleta novamente. Você tem ${params.timeoutMinutes} min para entrar em contato.`
        : `O lead ${params.leadName} está na sua vez na roleta. Você tem ${params.timeoutMinutes} min para entrar em contato.`,
      url: "/broker/dashboard",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: turnTag(params.leadId),
    });
  } catch (error) {
    console.error("[push] falha ao notificar vez do corretor", { leadId: params.leadId, error: String(error) });
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

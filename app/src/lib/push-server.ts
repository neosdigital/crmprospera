import webpush, { WebPushError } from "web-push";
import { prisma } from "@crm/db";

const VAPID_SUBJECT = process.env.VAPID_SUBJECT;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
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

/**
 * Notifica TODOS os admins/donos e corretores ativos da organização sobre um lead novo.
 * Nunca lança (chamado via `after()` nas rotas de criação de lead — não pode atrasar nem
 * quebrar a resposta). Cada inscrição é enviada em paralelo; falhas são isoladas por inscrição.
 */
export async function notifyNewLead(lead: {
  id: string;
  organizationId: string;
  name: string;
  source: string;
}): Promise<void> {
  if (!ensureConfigured()) return;

  try {
    const users = await prisma.user.findMany({
      where: {
        organizationId: lead.organizationId,
        status: "ACTIVE",
        OR: [{ role: "OWNER" }, { role: "ADMIN" }, { role: "BROKER", broker: { status: "ACTIVE" } }],
      },
      include: { pushSubscriptions: true },
    });

    if (users.length === 0) return;

    const payload: PushPayload = {
      title: "Novo lead!",
      body: `${lead.name} - ${sourceLabel(lead.source)}`,
      url: `/leads/${lead.id}`,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: `lead-${lead.id}`,
    };

    await Promise.allSettled(
      users.flatMap((user) => {
        const userPayload: PushPayload =
          user.role === "BROKER" ? { ...payload, url: "/broker/dashboard" } : payload;
        return user.pushSubscriptions.map((sub) => sendToSubscription(sub, userPayload));
      })
    );
  } catch (error) {
    console.error("[push] falha ao notificar novo lead", { leadId: lead.id, error: String(error) });
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

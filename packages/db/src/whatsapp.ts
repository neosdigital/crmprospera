import { prisma } from "./index";
import { AuditAction } from "@prisma/client";
import { decryptSecret } from "./crypto";

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const TEMPLATE_LANGUAGE = "pt_BR";

/**
 * Nomes e textos dos templates que precisam ser criados e aprovados no WhatsApp
 * Manager (Meta Business) antes do envio funcionar — mensagens business-initiated
 * fora da janela de 24h só podem usar templates pré-aprovados. Exportado para a
 * tela de configurações mostrar o texto exato a submeter.
 */
export const WHATSAPP_TEMPLATES = {
  NEW_ASSIGNMENT: {
    name: "novo_lead_atribuido",
    category: "UTILITY",
    language: TEMPLATE_LANGUAGE,
    body: "Olá {{1}}! Você recebeu um novo lead no CRM Próspera: {{2}}, telefone {{3}}. Você tem {{4}} minutos para entrar em contato antes que ele passe para o próximo corretor.",
  },
  EXPIRED: {
    name: "lead_expirado_corretor",
    category: "UTILITY",
    language: TEMPLATE_LANGUAGE,
    body: "Atenção {{1}}: o tempo para atender o lead {{2}} esgotou e ele foi transferido para o próximo corretor da fila.",
  },
  RETURNED: {
    name: "lead_retornou_corretor",
    category: "UTILITY",
    language: TEMPLATE_LANGUAGE,
    body: "Atenção {{1}}! O lead {{2}} (telefone {{3}}) já passou por toda a equipe sem resposta e voltou para você. Você tem mais {{4}} minutos para entrar em contato.",
  },
} as const;

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Checagem barata (1 query, só o necessário) para o caller decidir se vale a pena
 * buscar broker/lead/org antes de tentar notificar — a grande maioria das
 * organizações não tem WhatsApp configurado, então evitamos esse custo por padrão.
 */
export async function hasActiveWhatsAppIntegration(organizationId: string): Promise<boolean> {
  const integration = await prisma.whatsAppIntegration.findUnique({
    where: { organizationId },
    select: { isActive: true },
  });
  return integration?.isActive ?? false;
}

/** Confere se o phone_number_id + token são válidos — usado no botão "Testar conexão". */
export async function testWhatsAppNumber(phoneNumberId: string, accessToken: string) {
  const url = new URL(`${GRAPH_BASE}/${phoneNumberId}`);
  url.searchParams.set("fields", "display_phone_number,verified_name");
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = (await res.json()) as { error?: { message?: string }; display_phone_number: string; verified_name: string };
  if (!res.ok) {
    const message = json?.error?.message || `Erro ao validar o número (${res.status})`;
    throw new Error(message);
  }
  return json;
}

async function sendTemplateMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  bodyParams: string[];
}) {
  const res = await fetch(`${GRAPH_BASE}/${params.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: onlyDigits(params.to),
      type: "template",
      template: {
        name: params.templateName,
        language: { code: TEMPLATE_LANGUAGE },
        components: [
          {
            type: "body",
            parameters: params.bodyParams.map((text) => ({ type: "text", text })),
          },
        ],
      },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; error_user_msg?: string } };
  if (!res.ok) {
    const message = json?.error?.error_user_msg || json?.error?.message || `Erro ao enviar WhatsApp (${res.status})`;
    throw new Error(message);
  }
  return json;
}

/**
 * Envio manual usado pelo botão "Enviar teste" das configurações: usa a integração
 * ativa da organização, mas (ao contrário de sendBestEffort) propaga o erro para a
 * rota de API mostrar ao dono exatamente o que a Graph API respondeu (ex.: template
 * ainda não aprovado, número fora da lista de teste, etc.).
 */
export async function sendTestMessage(organizationId: string, to: string, brokerName: string) {
  const integration = await prisma.whatsAppIntegration.findUnique({ where: { organizationId } });
  if (!integration || !integration.isActive) {
    throw new Error("Nenhuma integração de WhatsApp conectada para esta organização.");
  }

  const accessToken = decryptSecret(integration.accessTokenEncrypted);
  return sendTemplateMessage({
    phoneNumberId: integration.phoneNumberId,
    accessToken,
    to,
    templateName: WHATSAPP_TEMPLATES.NEW_ASSIGNMENT.name,
    bodyParams: [brokerName, "Lead de Teste", "+5547999998888", "5"],
  });
}

/**
 * Envia uma mensagem de template para um número, usando a integração ativa da
 * organização. Best-effort e silencioso: nunca lança — se não houver integração
 * configurada, token inválido, ou o número do corretor estiver vazio, apenas
 * registra (ou nem registra, se a integração não existir) e segue em frente,
 * para nunca travar a distribuição/expiração do lead por causa do WhatsApp.
 */
async function sendBestEffort(params: {
  organizationId: string;
  to: string | null;
  templateName: string;
  bodyParams: string[];
  leadId?: string;
}) {
  if (!params.to) return;

  const integration = await prisma.whatsAppIntegration.findUnique({
    where: { organizationId: params.organizationId },
  });
  if (!integration || !integration.isActive) return;

  try {
    const accessToken = decryptSecret(integration.accessTokenEncrypted);
    await sendTemplateMessage({
      phoneNumberId: integration.phoneNumberId,
      accessToken,
      to: params.to,
      templateName: params.templateName,
      bodyParams: params.bodyParams,
    });

    await prisma.$transaction([
      prisma.whatsAppIntegration.update({
        where: { id: integration.id },
        data: { lastMessageAt: new Date(), lastError: null, lastErrorAt: null },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: params.organizationId,
          leadId: params.leadId,
          action: AuditAction.WHATSAPP_SENT,
          entityType: "whatsapp",
          entityId: integration.id,
          metadata: { to: params.to, template: params.templateName },
        },
      }),
    ]);
  } catch (error) {
    const message = (error as Error).message;
    console.error("[whatsapp] falha ao enviar mensagem", { organizationId: params.organizationId, error: message });
    await prisma.$transaction([
      prisma.whatsAppIntegration.update({
        where: { id: integration.id },
        data: { lastError: message, lastErrorAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: params.organizationId,
          leadId: params.leadId,
          action: AuditAction.WHATSAPP_FAILED,
          entityType: "whatsapp",
          entityId: integration.id,
          metadata: { to: params.to, template: params.templateName, error: message },
        },
      }),
    ]).catch((e) => console.error("[whatsapp] falha ao registrar erro", e));
  }
}

/**
 * Notifica o corretor por WhatsApp quando um lead é atribuído a ele. `isReturning` indica
 * que este NÃO é a primeira vez que este corretor vê este lead — a roleta deu uma volta
 * completa (ninguém respondeu) e voltou até ele de novo. Nesse caso usa um template
 * diferente (RETURNED), avisando que o lead já passou pela equipe toda, em vez de repetir
 * a mesma mensagem de "novo lead" a cada volta.
 */
export async function notifyBrokerNewAssignment(params: {
  organizationId: string;
  leadId: string;
  brokerPhone: string | null;
  brokerName: string;
  leadName: string;
  leadPhone: string | null;
  timeoutMinutes: number;
  isReturning: boolean;
}) {
  const template = params.isReturning ? WHATSAPP_TEMPLATES.RETURNED : WHATSAPP_TEMPLATES.NEW_ASSIGNMENT;
  await sendBestEffort({
    organizationId: params.organizationId,
    to: params.brokerPhone,
    leadId: params.leadId,
    templateName: template.name,
    bodyParams: [
      params.brokerName,
      params.leadName,
      params.leadPhone ?? "não informado",
      String(params.timeoutMinutes),
    ],
  });
}

/** Notifica o corretor por WhatsApp quando ele deixa o tempo esgotar sem responder. */
export async function notifyBrokerExpired(params: {
  organizationId: string;
  leadId: string;
  brokerPhone: string | null;
  brokerName: string;
  leadName: string;
}) {
  await sendBestEffort({
    organizationId: params.organizationId,
    to: params.brokerPhone,
    leadId: params.leadId,
    templateName: WHATSAPP_TEMPLATES.EXPIRED.name,
    bodyParams: [params.brokerName, params.leadName],
  });
}

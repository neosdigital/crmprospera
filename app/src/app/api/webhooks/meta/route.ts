import { NextResponse } from "next/server";
import { prisma, AuditAction, distributeNewLead, decryptSecret } from "@crm/db";
import { notifyNewLead } from "@/lib/push-server";
import { runAfterResponse } from "@/lib/run-after-response";
import {
  verifyMetaSignature,
  fetchLeadDetails,
  fetchAdContext,
  fetchFormName,
  normalizeFieldData,
  extractContactInfo,
  type MetaWebhookPayload,
} from "@/lib/meta";

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), scope: "META_WEBHOOK", event, ...data }));
}

/**
 * Verificação do webhook exigida pela Meta ao configurar a URL no App Dashboard.
 * Deve responder com o valor de hub.challenge (texto puro) quando hub.verify_token
 * bater com o token configurado — ver docs/graph-api/webhooks/getting-started.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN && challenge) {
    log("webhook_verified");
    return new NextResponse(challenge, { status: 200 });
  }

  log("webhook_verification_failed", { mode });
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Recebimento de eventos leadgen. Fluxo (seção 13 do escopo):
 * valida assinatura -> identifica organização pela page_id -> busca lead completo na
 * Graph API -> normaliza -> salva (meta_lead_id único = idempotência) -> distribui.
 *
 * Sempre respondemos 200 mesmo quando um item específico falha, para não entrar no
 * ciclo de retentativas de 36h da Meta por causa de um único evento problemático — os
 * erros ficam registrados nos logs estruturados e em audit_logs.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const signatureValid = verifyMetaSignature(rawBody, signature);

  // Registro de diagnóstico best-effort: mesmo se a assinatura falhar, tentamos identificar
  // a organização pelo page_id do payload (sem confiar nos dados ainda) só para deixar rastro
  // no banco de que a Meta chamou o webhook — sem isso, "nada no banco" é ambíguo entre "a
  // Meta nunca chamou" e "chamou e foi rejeitado por assinatura inválida", e não temos acesso
  // aos logs de execução da Vercel para diferenciar.
  try {
    const maybePageId = JSON.parse(rawBody)?.entry?.[0]?.id;
    if (maybePageId) {
      const integration = await prisma.metaIntegration.findFirst({ where: { pageId: String(maybePageId) } });
      if (integration) {
        await prisma.auditLog.create({
          data: {
            organizationId: integration.organizationId,
            action: AuditAction.WEBHOOK_RECEIVED,
            entityType: "meta_integration",
            entityId: integration.id,
            metadata: { signatureValid, signaturePresent: Boolean(signature) },
          },
        });
      }
    }
  } catch {
    // best-effort — nunca deve impedir o fluxo principal
  }

  if (!signatureValid) {
    log("invalid_signature");
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  if (payload.object !== "page" && payload.object !== "whatsapp_business_account") {
    return NextResponse.json({ ok: true, skipped: "unsupported_object" });
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === "leadgen") {
        try {
          await processLeadgenEvent(change.value);
        } catch (error) {
          log("process_event_error", { leadgenId: change.value.leadgen_id, error: String(error) });
        }
      } else if (change.field === "messages") {
        try {
          await processMessageStatusEvent(change.value as unknown as WhatsAppStatusValue);
        } catch (error) {
          log("process_status_error", { error: String(error) });
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}

type WhatsAppStatusValue = {
  metadata?: { phone_number_id?: string };
  statuses?: {
    id: string;
    status: string;
    recipient_id?: string;
    errors?: { code: number; title: string; message?: string }[];
  }[];
};

/**
 * Status de entrega de mensagens do WhatsApp (sent/delivered/read/failed), enviados
 * pela Meta quando o app está inscrito no campo "messages" da WABA. Registrado em
 * AuditLog sem conteúdo de mensagem — só status, wamid e o erro estruturado da Meta,
 * pra dar visibilidade real de "chegou ou não e por quê" sem depender dos logs da
 * Vercel (que não temos acesso via dashboard aqui).
 */
async function processMessageStatusEvent(value: WhatsAppStatusValue) {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const integration = await prisma.whatsAppIntegration.findFirst({ where: { phoneNumberId } });
  if (!integration) {
    log("whatsapp_status_no_integration", { phoneNumberId });
    return;
  }

  for (const status of value.statuses ?? []) {
    const isFailed = status.status === "failed";
    await prisma.auditLog.create({
      data: {
        organizationId: integration.organizationId,
        action: isFailed ? AuditAction.WHATSAPP_FAILED : AuditAction.WHATSAPP_SENT,
        entityType: "whatsapp_message",
        entityId: status.id,
        metadata: {
          status: status.status,
          recipientId: status.recipient_id,
          errors: status.errors,
        },
      },
    });
    log("whatsapp_status", { wamid: status.id, status: status.status, errors: status.errors });
  }
}

async function processLeadgenEvent(value: {
  leadgen_id: string;
  page_id: string;
  form_id: string;
  adgroup_id?: string;
  ad_id?: string;
  created_time: number;
}) {
  const leadgenId = String(value.leadgen_id);
  const pageId = String(value.page_id);

  const integration = await prisma.metaIntegration.findFirst({
    where: { pageId, isActive: true },
  });

  if (!integration) {
    log("no_integration_for_page", { pageId });
    return;
  }

  await prisma.metaIntegration.update({
    where: { id: integration.id },
    data: { lastEventAt: new Date() },
  });

  // Idempotência: se a Meta reenviar o mesmo evento, não duplicamos o lead nem re-distribuímos.
  const existing = await prisma.lead.findUnique({ where: { metaLeadId: leadgenId } });
  if (existing) {
    log("duplicate_event_ignored", { leadgenId, leadId: existing.id });
    await prisma.auditLog.create({
      data: {
        organizationId: integration.organizationId,
        leadId: existing.id,
        action: AuditAction.WEBHOOK_DUPLICATE,
        entityType: "lead",
        entityId: existing.id,
        metadata: { leadgenId },
      },
    });
    return;
  }

  const accessToken = decryptSecret(integration.accessTokenEncrypted);
  const details = await fetchLeadDetails(leadgenId, accessToken);
  const contact = extractContactInfo(details.field_data);
  const customFields = normalizeFieldData(details.field_data);

  let campaignId: string | undefined;
  let campaignName: string | undefined;
  let adsetId: string | undefined;
  let adsetName: string | undefined;
  let adName: string | undefined;
  let formName: string | undefined;

  const adId = details.ad_id ?? value.ad_id;
  const formId = details.form_id ?? value.form_id;

  if (adId) {
    try {
      const adContext = await fetchAdContext(adId, accessToken);
      adName = adContext.name;
      campaignId = adContext.campaign?.id;
      campaignName = adContext.campaign?.name;
      adsetId = adContext.adset?.id;
      adsetName = adContext.adset?.name;
    } catch (error) {
      log("ad_context_lookup_failed", { adId, error: String(error) });
    }
  }

  if (formId) {
    try {
      const form = await fetchFormName(formId, accessToken);
      formName = form.name;
    } catch (error) {
      log("form_lookup_failed", { formId, error: String(error) });
    }
  }

  const lead = await prisma.lead.create({
    data: {
      organizationId: integration.organizationId,
      metaLeadId: leadgenId,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      source: "meta_ads",
      platform: "facebook",
      pageId,
      campaignId,
      campaignName,
      adsetId,
      adsetName: adsetName,
      adId,
      adName,
      formId,
      formName,
      customFields,
      createdAt: new Date(value.created_time * 1000),
    },
  });

  await prisma.metaIntegration.update({
    where: { id: integration.id },
    data: { lastLeadSyncAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: integration.organizationId,
      leadId: lead.id,
      action: AuditAction.LEAD_RECEIVED,
      entityType: "lead",
      entityId: lead.id,
      metadata: { source: "meta_webhook", leadgenId },
    },
  });

  log("lead_created", { leadId: lead.id, organizationId: integration.organizationId });

  const assignment = await distributeNewLead(integration.organizationId, lead.id);
  log("lead_distributed", { leadId: lead.id, assigned: Boolean(assignment) });

  runAfterResponse(() =>
    notifyNewLead({
      id: lead.id,
      organizationId: integration.organizationId,
      name: lead.name,
      source: lead.source,
    }).catch((error) => log("push_notify_error", { leadId: lead.id, error: String(error) }))
  );
}

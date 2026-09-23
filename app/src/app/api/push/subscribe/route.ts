import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/api";
import { prisma, AuditAction } from "@crm/db";

const bodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/**
 * Salva a inscrição de push do navegador atual. Upsert por `endpoint` (não create): o mesmo
 * navegador/dispositivo pode já ter uma inscrição salva de outro usuário (ex.: computador
 * compartilhado na imobiliária) — nesse caso, ela é reatribuída pro usuário que está logado
 * agora, em vez de falhar na constraint única.
 */
export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = bodySchema.parse(await req.json());
    const userAgent = req.headers.get("user-agent") ?? undefined;

    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent,
      },
      update: {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        action: AuditAction.PUSH_SUBSCRIBED,
        entityType: "push_subscription",
        entityId: subscription.id,
        metadata: { userAgent },
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

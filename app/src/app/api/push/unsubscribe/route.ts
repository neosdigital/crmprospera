import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/api";
import { prisma, AuditAction } from "@crm/db";

const bodySchema = z.object({ endpoint: z.string().url() });

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const { endpoint } = bodySchema.parse(await req.json());

    // Só apaga se o endpoint pertencer ao usuário logado — nunca deixa um usuário
    // desinscrever o dispositivo de outra pessoa adivinhando/forjando o endpoint.
    const existing = await prisma.pushSubscription.findUnique({ where: { endpoint } });
    if (existing && existing.userId === session.user.id) {
      await prisma.pushSubscription.delete({ where: { id: existing.id } });
      await prisma.auditLog.create({
        data: {
          organizationId: session.user.organizationId,
          userId: session.user.id,
          action: AuditAction.PUSH_UNSUBSCRIBED,
          entityType: "push_subscription",
          entityId: existing.id,
          metadata: {},
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

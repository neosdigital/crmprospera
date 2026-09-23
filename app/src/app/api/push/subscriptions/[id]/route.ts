import { NextResponse } from "next/server";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { prisma, AuditAction } from "@crm/db";

/** Remove um dispositivo da lista (botão "Remover" na tela de configurações). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const subscription = await prisma.pushSubscription.findUnique({ where: { id } });
    if (!subscription || subscription.userId !== session.user.id) {
      throw new ApiError(404, "Dispositivo não encontrado.");
    }

    await prisma.pushSubscription.delete({ where: { id } });
    await prisma.auditLog.create({
      data: {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        action: AuditAction.PUSH_UNSUBSCRIBED,
        entityType: "push_subscription",
        entityId: id,
        metadata: {},
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

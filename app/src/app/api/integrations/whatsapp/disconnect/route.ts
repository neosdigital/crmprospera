import { NextResponse } from "next/server";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { prisma, AuditAction } from "@crm/db";

export async function POST() {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);

    const integration = await prisma.whatsAppIntegration.findUnique({
      where: { organizationId: session.user.organizationId },
    });
    if (!integration) throw new ApiError(404, "Integração não encontrada.");

    await prisma.whatsAppIntegration.update({ where: { id: integration.id }, data: { isActive: false } });

    await prisma.auditLog.create({
      data: {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        action: AuditAction.INTEGRATION_DISCONNECTED,
        entityType: "whatsapp_integration",
        entityId: integration.id,
        metadata: {},
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

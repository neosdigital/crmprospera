import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { prisma, AuditAction } from "@crm/db";

const bodySchema = z.object({ integrationId: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const { integrationId } = bodySchema.parse(await req.json());

    const integration = await prisma.metaIntegration.findFirst({
      where: { id: integrationId, organizationId: session.user.organizationId },
    });
    if (!integration) throw new ApiError(404, "Integração não encontrada.");

    await prisma.metaIntegration.update({ where: { id: integration.id }, data: { isActive: false } });

    await prisma.auditLog.create({
      data: {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        action: AuditAction.INTEGRATION_DISCONNECTED,
        entityType: "meta_integration",
        entityId: integration.id,
        metadata: {},
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

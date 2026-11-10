import { NextResponse } from "next/server";
import { prisma } from "@crm/db";
import { requirePersonalAdmin, publicConnection, personalJsonError } from "@/lib/personal-area";

/** Dono/Admin: todos os corretores da imobiliária com o acesso à Área do Corretor e as integrações. */
export async function GET() {
  try {
    const viewer = await requirePersonalAdmin();
    const brokers = await prisma.broker.findMany({
      where: { organizationId: viewer.organizationId },
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        displayName: true,
        status: true,
        user: { select: { email: true, status: true } },
        personalAccess: { select: { enabled: true, enabledAt: true, disabledAt: true } },
        brokerMetaConnections: { include: { forms: true }, orderBy: { createdAt: "asc" } },
        _count: { select: { personalLeads: true } },
      },
    });

    return NextResponse.json({
      brokers: brokers.map((b) => ({
        id: b.id,
        name: b.displayName,
        email: b.user.email,
        status: b.status,
        accessEnabled: b.personalAccess?.enabled ?? false,
        enabledAt: b.personalAccess?.enabledAt ?? null,
        disabledAt: b.personalAccess?.disabledAt ?? null,
        personalLeads: b._count.personalLeads,
        connections: b.brokerMetaConnections.map(publicConnection),
      })),
    });
  } catch (error) {
    return personalJsonError(error);
  }
}

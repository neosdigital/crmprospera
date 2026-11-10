import { NextResponse } from "next/server";
import { prisma, LeadStatus } from "@crm/db";
import {
  requirePersonalViewer,
  resolveBrokerScope,
  personalLeadScope,
  periodFilter,
  publicConnection,
  personalJsonError,
} from "@/lib/personal-area";

const IN_SERVICE: LeadStatus[] = [LeadStatus.CONTACTED, LeadStatus.IN_PROGRESS, LeadStatus.SCHEDULED];

/**
 * Indicadores + integrações da Área do Corretor. Corretor: só a própria carteira particular.
 * Admin: `?brokerId=` de um corretor da imobiliária (ou todos, sem o parâmetro).
 */
export async function GET(req: Request) {
  try {
    const viewer = await requirePersonalViewer();
    const url = new URL(req.url);
    const brokerId = await resolveBrokerScope(viewer, url.searchParams.get("brokerId"));
    const where = { ...personalLeadScope(viewer, brokerId), ...periodFilter(url.searchParams.get("from"), url.searchParams.get("to")) };

    const [byStatus, campaigns, connections, latest] = await Promise.all([
      prisma.personalLead.groupBy({ by: ["status"], where, _count: { _all: true } }),
      prisma.personalLead.findMany({
        where: { ...personalLeadScope(viewer, brokerId), campaignName: { not: null } },
        distinct: ["campaignName"],
        select: { campaignName: true },
        orderBy: { campaignName: "asc" },
        take: 200,
      }),
      prisma.brokerMetaConnection.findMany({
        where: { organizationId: viewer.organizationId, ...(brokerId ? { brokerId } : {}) },
        include: { forms: true, broker: { select: { displayName: true } }, _count: { select: { leads: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.personalLead.findFirst({
        where: personalLeadScope(viewer, brokerId),
        orderBy: { receivedAt: "desc" },
        select: { id: true, name: true, receivedAt: true },
      }),
    ]);

    const count = (statuses: LeadStatus[]) =>
      byStatus.filter((s) => statuses.includes(s.status)).reduce((sum, s) => sum + s._count._all, 0);

    return NextResponse.json({
      kpis: {
        total: byStatus.reduce((sum, s) => sum + s._count._all, 0),
        new: count([LeadStatus.NEW]),
        inService: count(IN_SERVICE),
        qualified: count([LeadStatus.QUALIFIED]),
        converted: count([LeadStatus.CONVERTED]),
        lost: count([LeadStatus.LOST]),
      },
      campaigns: campaigns.map((c) => c.campaignName).filter(Boolean),
      connections: connections.map((c) => ({
        ...publicConnection(c),
        brokerName: c.broker.displayName,
        leadsReceived: c._count.leads,
      })),
      latestLead: latest,
      viewer: { isAdmin: viewer.isAdmin },
    });
  } catch (error) {
    return personalJsonError(error);
  }
}

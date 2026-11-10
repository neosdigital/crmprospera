import { NextResponse } from "next/server";
import { prisma, isPersonalLeadStatus } from "@crm/db";
import {
  requirePersonalViewer,
  resolveBrokerScope,
  personalLeadScope,
  periodFilter,
  personalJsonError,
} from "@/lib/personal-area";

/** Carteira particular (lista e kanban). Filtros: período (from/to), campaign, status, q. */
export async function GET(req: Request) {
  try {
    const viewer = await requirePersonalViewer();
    const url = new URL(req.url);
    const brokerId = await resolveBrokerScope(viewer, url.searchParams.get("brokerId"));
    const status = url.searchParams.get("status");
    const campaign = url.searchParams.get("campaign");
    const q = url.searchParams.get("q")?.trim();

    const leads = await prisma.personalLead.findMany({
      where: {
        ...personalLeadScope(viewer, brokerId),
        ...periodFilter(url.searchParams.get("from"), url.searchParams.get("to")),
        ...(status && isPersonalLeadStatus(status) ? { status } : {}),
        ...(campaign ? { campaignName: campaign } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { phone: { contains: q } },
                { email: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { broker: { select: { displayName: true } }, _count: { select: { notes: true } } },
    });

    return NextResponse.json({
      leads: leads.map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        email: l.email,
        campaignName: l.campaignName,
        formName: l.formName,
        status: l.status,
        sourceType: l.sourceType,
        createdAt: l.createdAt,
        receivedAt: l.receivedAt,
        updatedAt: l.updatedAt,
        remarketingNotifyAt: l.remarketingNotifyAt,
        brokerId: l.brokerId,
        brokerName: viewer.isAdmin ? l.broker.displayName : null,
        noteCount: l._count.notes,
      })),
    });
  } catch (error) {
    return personalJsonError(error);
  }
}

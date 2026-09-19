import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";
import { sweepOrganizationExpirations } from "@crm/db";

export async function GET() {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);

    await sweepOrganizationExpirations(session.user.organizationId);

    const db = scopedDb(session.user.organizationId);

    const activeLeads = await db.lead.findMany({
      where: { status: { in: ["ASSIGNED", "CONTACTED", "IN_PROGRESS"] } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        currentBroker: { select: { id: true, displayName: true } },
        assignments: {
          orderBy: { attemptNumber: "asc" },
          include: { broker: { select: { displayName: true } } },
        },
      },
    });

    const recentlyExpired = await db.lead.findMany({
      where: { status: "EXPIRED", updatedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });

    return NextResponse.json({
      activeLeads: activeLeads.map((lead) => {
        const currentAssignment =
          lead.assignments.find((a) => a.status === "ASSIGNED") ?? lead.assignments[lead.assignments.length - 1];

        return {
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          campaignName: lead.campaignName,
          customFields: lead.customFields,
          status: lead.status,
          brokerName: lead.currentBroker?.displayName ?? null,
          assignedAt: currentAssignment?.assignedAt ?? null,
          expiresAt: currentAssignment?.status === "ASSIGNED" ? currentAssignment.expiresAt : null,
          brokersPassedCount: lead.assignments.length,
          brokersPassedNames: lead.assignments.map((a) => a.broker.displayName),
        };
      }),
      recentlyExpired: recentlyExpired.map((lead) => ({ id: lead.id, name: lead.name })),
      serverNow: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

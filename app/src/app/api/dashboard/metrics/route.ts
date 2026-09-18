import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";
import { prisma } from "@crm/db";

function startOfPeriod(period: string): Date {
  const now = new Date();
  if (period === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()); // "today"
}

export async function GET(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const db = scopedDb(session.user.organizationId);
    const organizationId = session.user.organizationId;

    const url = new URL(req.url);
    const period = url.searchParams.get("period") ?? "today";
    const since = startOfPeriod(period);

    const [
      leadsInPeriod,
      waiting,
      inProgress,
      contactedAssignments,
      totalAssignmentsInPeriod,
      converted,
      leadsByBroker,
      leadsByCampaign,
      leadsByStatus,
      expiredByBroker,
    ] = await Promise.all([
      db.lead.count({ where: { createdAt: { gte: since } } }),
      db.lead.count({ where: { status: { in: ["WAITING_ASSIGNMENT", "ASSIGNED"] } } }),
      db.lead.count({ where: { status: { in: ["CONTACTED", "IN_PROGRESS", "QUALIFIED", "SCHEDULED"] } } }),
      db.leadAssignment.findMany({
        where: { organizationId, status: "CONTACTED", assignedAt: { gte: since } },
        select: { assignedAt: true, respondedAt: true },
      }),
      db.leadAssignment.count({ where: { assignedAt: { gte: since } } }),
      db.lead.count({ where: { status: "CONVERTED", convertedAt: { gte: since } } }),
      db.broker.findMany({
        where: {},
        select: {
          id: true,
          displayName: true,
          status: true,
          isInRotation: true,
          rotationPosition: true,
          _count: { select: { leadAssignments: true } },
          leadAssignments: {
            where: { assignedAt: { gte: since } },
            select: { status: true },
          },
        },
        orderBy: { rotationPosition: "asc" },
      }),
      db.lead.groupBy({
        by: ["campaignName"],
        where: { createdAt: { gte: since }, campaignName: { not: null } },
        _count: { _all: true },
      }),
      db.lead.groupBy({
        by: ["status"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      db.leadAssignment.groupBy({
        by: ["brokerId"],
        where: { status: "EXPIRED", assignedAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);

    const responseTimesMs = contactedAssignments
      .filter((a) => a.respondedAt)
      .map((a) => a.respondedAt!.getTime() - a.assignedAt.getTime());
    const avgResponseMs =
      responseTimesMs.length > 0
        ? responseTimesMs.reduce((sum, v) => sum + v, 0) / responseTimesMs.length
        : null;

    const responseRate =
      totalAssignmentsInPeriod > 0 ? contactedAssignments.length / totalAssignmentsInPeriod : null;

    const rotationState = await prisma.rotationState.findUnique({ where: { organizationId } });

    return NextResponse.json({
      period,
      kpis: {
        leadsInPeriod,
        waiting,
        inProgress,
        avgResponseMs,
        responseRate,
        converted,
      },
      brokerRanking: leadsByBroker.map((b) => ({
        id: b.id,
        name: b.displayName,
        status: b.status,
        isInRotation: b.isInRotation,
        rotationPosition: b.rotationPosition,
        totalReceived: b.leadAssignments.length,
        totalExpired: b.leadAssignments.filter((a) => a.status === "EXPIRED").length,
        totalContacted: b.leadAssignments.filter((a) => a.status === "CONTACTED").length,
      })),
      leadsByCampaign: leadsByCampaign.map((c) => ({ campaign: c.campaignName, count: c._count._all })),
      leadsByStatus: leadsByStatus.map((s) => ({ status: s.status, count: s._count._all })),
      expiredByBroker,
      rotation: {
        currentPosition: rotationState?.currentPosition ?? null,
        nextBroker:
          leadsByBroker
            .filter((b) => b.status === "ACTIVE" && b.isInRotation)
            .find((b) => b.rotationPosition >= (rotationState?.currentPosition ?? 1))?.displayName ??
          leadsByBroker.find((b) => b.status === "ACTIVE" && b.isInRotation)?.displayName ??
          null,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

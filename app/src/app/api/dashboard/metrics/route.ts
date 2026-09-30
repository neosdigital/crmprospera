import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";
import { isQuietHours } from "@crm/db";
import { resolveMetricsPeriod } from "@/lib/metrics-period";

/**
 * Tentativas que entram nas métricas de desempenho dos corretores. Das 23h às 07h a roleta
 * gira normalmente, mas ninguém é notificado — então um lead que passou de madrugada sem
 * resposta NÃO conta como "recebido/expirado" contra o corretor (nem derruba a taxa de
 * resposta). Se o corretor pegou mesmo de madrugada, conta normalmente (a favor dele).
 */
function countsInMetrics(a: { assignedAt: Date; status: string }) {
  return a.status === "CONTACTED" || !isQuietHours(a.assignedAt);
}


export async function GET(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const db = scopedDb(session.user.organizationId);
    const organizationId = session.user.organizationId;

    const url = new URL(req.url);
    const { period, since, until } = resolveMetricsPeriod(url.searchParams);

    const [
      leadsInPeriod,
      waiting,
      inProgress,
      contactedAssignments,
      assignmentsInPeriod,
      converted,
      leadsByBroker,
      leadsByCampaign,
      leadsByStatus,
      expiredAssignments,
    ] = await Promise.all([
      db.lead.count({ where: { createdAt: { gte: since, lte: until } } }),
      db.lead.count({ where: { status: { in: ["WAITING_ASSIGNMENT", "ASSIGNED"] } } }),
      db.lead.count({ where: { status: { in: ["CONTACTED", "IN_PROGRESS", "QUALIFIED", "SCHEDULED"] } } }),
      db.leadAssignment.findMany({
        where: { organizationId, status: "CONTACTED", assignedAt: { gte: since, lte: until } },
        select: { assignedAt: true, respondedAt: true },
      }),
      db.leadAssignment.findMany({
        where: { assignedAt: { gte: since, lte: until } },
        select: { assignedAt: true, status: true },
      }),
      db.lead.count({ where: { status: "CONVERTED", convertedAt: { gte: since, lte: until } } }),
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
            where: { assignedAt: { gte: since, lte: until } },
            select: { status: true, assignedAt: true },
          },
        },
        orderBy: { rotationPosition: "asc" },
      }),
      db.lead.groupBy({
        by: ["campaignName"],
        where: { createdAt: { gte: since, lte: until }, campaignName: { not: null } },
        _count: { _all: true },
      }),
      db.lead.groupBy({
        by: ["status"],
        where: { createdAt: { gte: since, lte: until } },
        _count: { _all: true },
      }),
      db.leadAssignment.findMany({
        where: { status: "EXPIRED", assignedAt: { gte: since, lte: until } },
        select: { brokerId: true, assignedAt: true, status: true },
      }),
    ]);

    const countedAssignments = assignmentsInPeriod.filter(countsInMetrics);
    const totalAssignmentsInPeriod = countedAssignments.length;
    const expiredByBroker = Object.entries(
      expiredAssignments.filter(countsInMetrics).reduce<Record<string, number>>((acc, a) => {
        acc[a.brokerId] = (acc[a.brokerId] ?? 0) + 1;
        return acc;
      }, {})
    ).map(([brokerId, count]) => ({ brokerId, _count: { _all: count } }));

    const responseTimesMs = contactedAssignments
      .filter((a) => a.respondedAt)
      .map((a) => a.respondedAt!.getTime() - a.assignedAt.getTime());
    const avgResponseMs =
      responseTimesMs.length > 0
        ? responseTimesMs.reduce((sum, v) => sum + v, 0) / responseTimesMs.length
        : null;

    const responseRate =
      totalAssignmentsInPeriod > 0 ? contactedAssignments.length / totalAssignmentsInPeriod : null;

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
      brokerRanking: leadsByBroker.map((b) => {
        const counted = b.leadAssignments.filter(countsInMetrics);
        return {
          id: b.id,
          name: b.displayName,
          status: b.status,
          isInRotation: b.isInRotation,
          rotationPosition: b.rotationPosition,
          totalReceived: counted.length,
          totalExpired: counted.filter((a) => a.status === "EXPIRED").length,
          totalContacted: counted.filter((a) => a.status === "CONTACTED").length,
        };
      }),
      leadsByCampaign: leadsByCampaign.map((c) => ({ campaign: c.campaignName, count: c._count._all })),
      leadsByStatus: leadsByStatus.map((s) => ({ status: s.status, count: s._count._all })),
      expiredByBroker,
      rotation: {
        // Todo lead novo vai sempre para o topo do ranking (ver packages/db/src/rotation.ts) —
        // "próximo" não é mais um ponteiro rotativo, é simplesmente o primeiro corretor
        // ativo do ranking.
        nextBroker: leadsByBroker.find((b) => b.status === "ACTIVE" && b.isInRotation)?.displayName ?? null,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

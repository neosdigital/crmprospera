import { NextResponse } from "next/server";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";
import { sweepOrganizationExpirations, brokersAheadInRotation } from "@crm/db";

export async function GET() {
  try {
    const session = await requireSession(["BROKER"]);
    if (!session.user.brokerId) throw new ApiError(403, "Usuário não é um corretor.");

    await sweepOrganizationExpirations(session.user.organizationId);

    const db = scopedDb(session.user.organizationId);

    const broker = await db.broker.findUnique({
      where: { id: session.user.brokerId },
      select: { soundEnabled: true, rotationPosition: true },
    });

    // Leads circulando na roleta com OUTROS corretores (ninguém pegou ainda) + quantos
    // corretores faltam até a vez deste — aviso minimalista no topo do dashboard.
    const [circulating, eligible] = await Promise.all([
      db.leadAssignment.findMany({
        where: { status: "ASSIGNED", brokerId: { not: session.user.brokerId } },
        orderBy: { assignedAt: "asc" },
        take: 10,
        select: {
          leadId: true,
          expiresAt: true,
          lead: { select: { name: true } },
          broker: { select: { rotationPosition: true } },
        },
      }),
      db.broker.findMany({
        where: { status: "ACTIVE", isInRotation: true },
        select: { rotationPosition: true },
      }),
    ]);
    const eligiblePositions = eligible.map((b) => b.rotationPosition);
    const rotationQueue = circulating.map((a) => ({
      leadId: a.leadId,
      leadName: a.lead.name,
      expiresAt: a.expiresAt,
      brokersAhead: broker ? brokersAheadInRotation(eligiblePositions, a.broker.rotationPosition, broker.rotationPosition) : null,
    }));

    const activeAssignments = await db.leadAssignment.findMany({
      where: { brokerId: session.user.brokerId, status: "ASSIGNED" },
      orderBy: { assignedAt: "asc" },
      include: { lead: true },
    });

    const recentHistory = await db.leadAssignment.findMany({
      where: { brokerId: session.user.brokerId, status: { not: "ASSIGNED" } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: { lead: { select: { id: true, name: true, phone: true, status: true } } },
    });

    return NextResponse.json({
      activeAssignments,
      recentHistory,
      rotationQueue,
      soundEnabled: broker?.soundEnabled ?? true,
      serverNow: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

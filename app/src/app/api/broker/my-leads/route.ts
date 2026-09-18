import { NextResponse } from "next/server";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";

export async function GET() {
  try {
    const session = await requireSession(["BROKER"]);
    if (!session.user.brokerId) throw new ApiError(403, "Usuário não é um corretor.");

    const db = scopedDb(session.user.organizationId);

    const broker = await db.broker.findUnique({
      where: { id: session.user.brokerId },
      select: { soundEnabled: true },
    });

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
      soundEnabled: broker?.soundEnabled ?? true,
      serverNow: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

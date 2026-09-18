import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";

export async function GET() {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const db = scopedDb(session.user.organizationId);

    const activeLeads = await db.lead.findMany({
      where: { status: { in: ["ASSIGNED", "CONTACTED", "IN_PROGRESS"] } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        currentBroker: { select: { id: true, displayName: true } },
        assignments: {
          where: { status: "ASSIGNED" },
          take: 1,
          orderBy: { attemptNumber: "desc" },
        },
      },
    });

    const recentlyExpired = await db.lead.findMany({
      where: { status: "EXPIRED", updatedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });

    return NextResponse.json({
      activeLeads: activeLeads.map((lead) => ({
        id: lead.id,
        name: lead.name,
        status: lead.status,
        brokerName: lead.currentBroker?.displayName ?? null,
        expiresAt: lead.assignments[0]?.expiresAt ?? null,
      })),
      recentlyExpired: recentlyExpired.map((lead) => ({ id: lead.id, name: lead.name })),
      serverNow: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

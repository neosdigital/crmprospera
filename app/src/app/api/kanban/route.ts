import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";

/**
 * Kanban de carteiras para dono/admin: mesmos leads que cada corretor vê em
 * /broker/wallet (já atendidos, em andamento até convertido/perdido). Sem `brokerId`
 * devolve a carteira de todos os corretores juntos; com `brokerId`, só a daquele corretor.
 */
export async function GET(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const db = scopedDb(session.user.organizationId);
    const brokerId = new URL(req.url).searchParams.get("brokerId");

    const leads = await db.lead.findMany({
      where: {
        currentBrokerId: brokerId ? brokerId : { not: null },
        status: { in: ["IN_PROGRESS", "QUALIFIED", "SCHEDULED", "CONVERTED", "LOST"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
      include: { currentBroker: { select: { displayName: true } } },
    });

    return NextResponse.json({
      leads: leads.map(({ currentBroker, ...lead }) => ({ ...lead, brokerName: currentBroker?.displayName ?? null })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

import { NextResponse } from "next/server";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";

/**
 * Leads atualmente na carteira do corretor logado: já responderam dentro do prazo
 * (por isso nunca inclui ASSIGNED, que é o card de "novo lead" no dashboard, nem
 * EXPIRED, que já foi transferido para outro corretor).
 */
export async function GET() {
  try {
    const session = await requireSession(["BROKER"]);
    if (!session.user.brokerId) throw new ApiError(403, "Usuário não é um corretor.");

    const db = scopedDb(session.user.organizationId);

    const leads = await db.lead.findMany({
      where: {
        currentBrokerId: session.user.brokerId,
        status: { in: ["IN_PROGRESS", "QUALIFIED", "SCHEDULED", "CONVERTED", "LOST"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });

    return NextResponse.json({ leads });
  } catch (error) {
    return jsonError(error);
  }
}

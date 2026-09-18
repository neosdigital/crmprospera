import { NextResponse } from "next/server";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const db = scopedDb(session.user.organizationId);

    const lead = await db.lead.findUnique({
      where: { id },
      include: {
        currentBroker: { select: { id: true, displayName: true, phone: true } },
        assignments: {
          orderBy: { attemptNumber: "asc" },
          include: { broker: { select: { id: true, displayName: true } } },
        },
        auditLogs: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!lead) throw new ApiError(404, "Lead não encontrado.");

    if (session.user.role === "BROKER") {
      const hasAccess =
        lead.currentBrokerId === session.user.brokerId ||
        lead.assignments.some((a) => a.brokerId === session.user.brokerId);
      if (!hasAccess) throw new ApiError(403, "Você não tem acesso a este lead.");
    }

    return NextResponse.json({ lead });
  } catch (error) {
    return jsonError(error);
  }
}

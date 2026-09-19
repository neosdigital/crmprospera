import { NextResponse } from "next/server";
import { z } from "zod";
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

const patchBodySchema = z.object({
  notes: z.string().max(5000).optional(),
});

/** Atualiza a observação de um lead. Corretor só pode editar leads atualmente na sua carteira. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const { notes } = patchBodySchema.parse(await req.json());
    const db = scopedDb(session.user.organizationId);

    const lead = await db.lead.findUnique({ where: { id } });
    if (!lead) throw new ApiError(404, "Lead não encontrado.");

    if (session.user.role === "BROKER" && lead.currentBrokerId !== session.user.brokerId) {
      throw new ApiError(403, "Você só pode editar leads atribuídos a você.");
    }

    const updated = await db.lead.update({
      where: { id },
      data: { notes },
    });

    return NextResponse.json({ lead: updated });
  } catch (error) {
    return jsonError(error);
  }
}

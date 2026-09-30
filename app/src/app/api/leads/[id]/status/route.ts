import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";
import { AuditAction, LeadStatus, computeLostReturnAt, validateLostReturnPeriod } from "@crm/db";

const ALLOWED_MANUAL_STATUSES = [
  LeadStatus.IN_PROGRESS,
  LeadStatus.QUALIFIED,
  LeadStatus.SCHEDULED,
  LeadStatus.CONVERTED,
  LeadStatus.LOST,
  LeadStatus.REMARKETING,
] as const;

const bodySchema = z.object({
  status: z.enum(ALLOWED_MANUAL_STATUSES),
  /**
   * Só para LOST: "Em quanto tempo esse lead volta para a roleta?". A data de retorno é
   * calculada aqui no servidor (nunca vem pronta do navegador). Opcional por compatibilidade
   * — sem período o lead fica em "Perdidos" sem retorno agendado, como antes.
   */
  returnPeriod: z
    .object({ unit: z.enum(["weeks", "months"]), amount: z.number() })
    .optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const { status, returnPeriod } = bodySchema.parse(await req.json());
    const db = scopedDb(session.user.organizationId);

    const lead = await db.lead.findUnique({ where: { id } });
    if (!lead) throw new ApiError(404, "Lead não encontrado.");

    if (session.user.role === "BROKER" && lead.currentBrokerId !== session.user.brokerId) {
      throw new ApiError(403, "Você só pode atualizar leads atribuídos a você.");
    }

    let returnToRotationAt: Date | null = null;
    if (status === LeadStatus.LOST && returnPeriod) {
      const invalid = validateLostReturnPeriod(returnPeriod);
      if (invalid) throw new ApiError(400, invalid);
      returnToRotationAt = computeLostReturnAt(new Date(), returnPeriod);
    }

    const updated = await db.lead.update({
      where: { id },
      data: {
        status,
        convertedAt: status === LeadStatus.CONVERTED ? new Date() : lead.convertedAt,
        // Sair de "Perdidos" (ou entrar sem prazo) cancela qualquer retorno agendado.
        returnToRotationAt,
      },
    });

    await db.auditLog.create({
      data: {
        organizationId: session.user.organizationId,
        leadId: id,
        userId: session.user.id,
        action: AuditAction.STATUS_CHANGED,
        entityType: "lead",
        entityId: id,
        metadata: {
          from: lead.status,
          to: status,
          ...(returnToRotationAt ? { returnToRotationAt: returnToRotationAt.toISOString(), returnPeriod } : {}),
        },
      },
    });

    return NextResponse.json({ lead: updated });
  } catch (error) {
    return jsonError(error);
  }
}

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
   * LOST: "Em quanto tempo esse lead volta para a roleta?"; REMARKETING: "Quando reenviar a
   * notificação para o corretor?". A data é
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

    // Mesmo prazo, dois usos: em "Perdido" a data devolve o lead para a roleta; em
    // "Remarketing" a data reenvia a notificação para o corretor que já está com o lead.
    let scheduledAt: Date | null = null;
    if ((status === LeadStatus.LOST || status === LeadStatus.REMARKETING) && returnPeriod) {
      const invalid = validateLostReturnPeriod(returnPeriod);
      if (invalid) throw new ApiError(400, invalid);
      scheduledAt = computeLostReturnAt(new Date(), returnPeriod);
    }
    const returnToRotationAt = status === LeadStatus.LOST ? scheduledAt : null;
    const remarketingNotifyAt = status === LeadStatus.REMARKETING ? scheduledAt : null;

    const updated = await db.lead.update({
      where: { id },
      data: {
        status,
        convertedAt: status === LeadStatus.CONVERTED ? new Date() : lead.convertedAt,
        // Sair de "Perdidos"/"Remarketing" (ou entrar sem prazo) cancela o agendamento.
        returnToRotationAt,
        remarketingNotifyAt,
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
          ...(remarketingNotifyAt ? { remarketingNotifyAt: remarketingNotifyAt.toISOString(), returnPeriod } : {}),
        },
      },
    });

    return NextResponse.json({ lead: updated });
  } catch (error) {
    return jsonError(error);
  }
}

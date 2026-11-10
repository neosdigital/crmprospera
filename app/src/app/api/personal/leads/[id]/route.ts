import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, updatePersonalLeadStatus, PERSONAL_LEAD_STATUSES } from "@crm/db";
import { requirePersonalViewer, loadPersonalLeadForViewer, personalJsonError } from "@/lib/personal-area";

/** Detalhes completos do lead particular + notas + histórico. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requirePersonalViewer();
    const { id } = await params;
    const lead = await loadPersonalLeadForViewer(viewer, id);

    const [notes, events, broker] = await Promise.all([
      prisma.personalLeadNote.findMany({
        where: { personalLeadId: lead.id },
        orderBy: { createdAt: "desc" },
        include: { author: { select: { name: true } } },
      }),
      prisma.personalLeadEvent.findMany({
        where: { personalLeadId: lead.id },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { user: { select: { name: true } } },
      }),
      prisma.broker.findUnique({ where: { id: lead.brokerId }, select: { displayName: true } }),
    ]);

    return NextResponse.json({
      lead: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        status: lead.status,
        sourceType: lead.sourceType,
        platform: lead.platform,
        pageId: lead.pageId,
        adAccountId: lead.adAccountId,
        campaignId: lead.campaignId,
        campaignName: lead.campaignName,
        adsetName: lead.adsetName,
        adName: lead.adName,
        formId: lead.formId,
        formName: lead.formName,
        metaLeadId: lead.metaLeadId,
        customFields: lead.customFields,
        remarketingNotifyAt: lead.remarketingNotifyAt,
        createdAt: lead.createdAt,
        receivedAt: lead.receivedAt,
        brokerName: broker?.displayName ?? null,
      },
      notes: notes.map((n) => ({ id: n.id, content: n.content, createdAt: n.createdAt, authorName: n.author?.name ?? null })),
      events: events.map((e) => ({ id: e.id, type: e.type, metadata: e.metadata, createdAt: e.createdAt, userName: e.user?.name ?? null })),
    });
  } catch (error) {
    return personalJsonError(error);
  }
}

const patchSchema = z.object({
  status: z.enum(PERSONAL_LEAD_STATUSES),
  reminderPeriod: z
    .object({ unit: z.enum(["weeks", "months"]), amount: z.number().int() })
    .optional(),
});

/** Muda a etapa do lead particular (e agenda o lembrete quando vai para Remarketing). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requirePersonalViewer();
    const { id } = await params;
    const lead = await loadPersonalLeadForViewer(viewer, id);
    const body = patchSchema.parse(await req.json());

    const updated = await updatePersonalLeadStatus({
      organizationId: viewer.organizationId,
      leadId: lead.id,
      userId: viewer.userId,
      status: body.status,
      reminderPeriod: body.reminderPeriod,
    });
    return NextResponse.json({ lead: { id: updated.id, status: updated.status, remarketingNotifyAt: updated.remarketingNotifyAt } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Etapa inválida." }, { status: 422 });
    return personalJsonError(error);
  }
}

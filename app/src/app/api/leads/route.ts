import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";
import { AuditAction, prisma, distributeNewLead, assignLeadManually } from "@crm/db";
import type { Prisma } from "@crm/db";
import { notifyNewLead, notifyLeadAssignedToBroker } from "@/lib/push-server";
import { runAfterResponse } from "@/lib/run-after-response";

const listQuerySchema = z.object({
  status: z.string().optional(),
  brokerId: z.string().optional(),
  campaignId: z.string().optional(),
  search: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const db = scopedDb(session.user.organizationId);

    const url = new URL(req.url);
    const query = listQuerySchema.parse(Object.fromEntries(url.searchParams));

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.brokerId) where.currentBrokerId = query.brokerId;
    if (query.campaignId) where.campaignId = query.campaignId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { phone: { contains: query.search } },
        { email: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const [leads, total] = await Promise.all([
      db.lead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          currentBroker: { select: { id: true, displayName: true } },
          _count: { select: { assignments: true } },
        },
      }),
      db.lead.count({ where }),
    ]);

    return NextResponse.json({ leads, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    return jsonError(error);
  }
}

const createLeadSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  source: z.string().default("manual"),
  campaignName: z.string().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(5000).optional(),
  /** Vazio/ausente = distribui pela roleta. Com id = vai direto pra carteira desse corretor. */
  brokerId: z.string().optional(),
});

/**
 * Criação manual de lead — exclusiva de dono/admin (corretor nunca cria lead). Leads reais
 * chegam via /api/webhooks/meta. Sem `brokerId` o lead entra na roleta normalmente; com
 * `brokerId` vai direto pra carteira do corretor escolhido (ver assignLeadManually).
 */
export async function POST(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const body = createLeadSchema.parse(await req.json());

    if (body.brokerId) {
      // Valida antes de criar, pra não sobrar um lead órfão se o corretor for inválido.
      const broker = await scopedDb(session.user.organizationId).broker.findFirst({ where: { id: body.brokerId } });
      if (!broker) throw new ApiError(404, "Corretor não encontrado.");
      if (broker.status === "INACTIVE") throw new ApiError(409, "Este corretor está inativo.");
    }

    const lead = await prisma.lead.create({
      data: {
        organizationId: session.user.organizationId,
        name: body.name,
        phone: body.phone,
        email: body.email || undefined,
        source: body.source,
        campaignName: body.campaignName,
        customFields: (body.customFields ?? {}) as Prisma.InputJsonValue,
        notes: body.notes?.trim() || undefined,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        leadId: lead.id,
        action: AuditAction.LEAD_RECEIVED,
        entityType: "lead",
        entityId: lead.id,
        metadata: { createdManuallyBy: session.user.id },
      },
    });

    if (body.brokerId) {
      const { lead: assigned } = await assignLeadManually({
        organizationId: session.user.organizationId,
        leadId: lead.id,
        brokerId: body.brokerId,
        userId: session.user.id,
      });
      const brokerId = body.brokerId;
      runAfterResponse(() => notifyLeadAssignedToBroker({ id: lead.id, name: lead.name }, brokerId));
      return NextResponse.json({ lead: assigned, assignment: null }, { status: 201 });
    }

    const assignment = await distributeNewLead(session.user.organizationId, lead.id);

    runAfterResponse(() =>
      notifyNewLead({
        id: lead.id,
        organizationId: session.user.organizationId,
        name: lead.name,
        source: lead.source,
      }).catch((error) => console.error("[push] falha ao notificar novo lead (manual)", error))
    );

    return NextResponse.json(
      {
        lead,
        assignment,
        warning: assignment
          ? undefined
          : "Lead criado, mas não há corretores ativos na roleta — ele ficou aguardando atribuição.",
      },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(error);
  }
}

const deleteBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

/**
 * Exclusão manual de leads (botão "Remover leads" em /leads) — só dono/admin, nunca
 * corretor. `scopedDb` garante que só apaga leads da própria organização mesmo que o
 * body chegue com ids de fora (deleteMany injeta organizationId automaticamente).
 * Cascata: lead_assignments some junto; audit_logs existentes ficam com lead_id nulo
 * (histórico preservado, sem referenciar um lead inexistente).
 */
export async function DELETE(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const { ids } = deleteBodySchema.parse(await req.json());
    const db = scopedDb(session.user.organizationId);

    const result = await db.lead.deleteMany({ where: { id: { in: ids } } });

    return NextResponse.json({ deletedCount: result.count });
  } catch (error) {
    return jsonError(error);
  }
}

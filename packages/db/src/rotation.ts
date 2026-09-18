import { prisma } from "./index";
import { AssignmentStatus, LeadStatus, AuditAction } from "@prisma/client";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

// Cada rodada da roleta encadeia várias queries sequenciais (lock, leituras, escritas,
// audit log) numa única transação. Sob a latência de rede até um Postgres remoto (ex.:
// Railway), isso pode facilmente passar do timeout padrão de 5s do Prisma para
// transações interativas — por isso ampliamos explicitamente aqui.
const TX_OPTIONS = { timeout: 15000, maxWait: 10000 };

export class ClaimError extends Error {
  code: "NOT_FOUND" | "ALREADY_HANDLED" | "EXPIRED" | "WRONG_BROKER";
  constructor(code: "NOT_FOUND" | "ALREADY_HANDLED" | "EXPIRED" | "WRONG_BROKER", message: string) {
    super(message);
    this.code = code;
    this.name = "ClaimError";
  }
}

/**
 * Escolhe o próximo corretor elegível a partir de rotation_state.current_position,
 * com wraparound (volta ao início da fila quando ultrapassa o último).
 * Corretores pausados/inativos são simplesmente pulados (seção 45 do escopo).
 */
async function pickNextBroker(tx: Tx, organizationId: string) {
  const eligible = await tx.broker.findMany({
    where: { organizationId, status: "ACTIVE", isInRotation: true },
    orderBy: { rotationPosition: "asc" },
  });

  if (eligible.length === 0) return null;

  const rotationState = await tx.rotationState.findUniqueOrThrow({
    where: { organizationId },
  });

  const next =
    eligible.find((b) => b.rotationPosition >= rotationState.currentPosition) ?? eligible[0];

  const newPosition = next.rotationPosition + 1;

  return { broker: next, newPosition };
}

/**
 * Cria uma nova tentativa de atribuição (lead_assignment) para o próximo corretor elegível
 * e avança o ponteiro da roleta. Deve ser chamada dentro de uma transação que já tenha
 * bloqueado (FOR UPDATE) a linha de rotation_state da organização, para serializar
 * atribuições concorrentes (seção 7 do escopo).
 */
export async function assignNextLead(
  tx: Tx,
  params: { organizationId: string; leadId: string; timeoutMinutes: number }
) {
  const { organizationId, leadId } = params;

  const lastAttempt = await tx.leadAssignment.findFirst({
    where: { leadId },
    orderBy: { attemptNumber: "desc" },
  });
  const attemptNumber = (lastAttempt?.attemptNumber ?? 0) + 1;

  const picked = await pickNextBroker(tx, organizationId);

  if (!picked) {
    await tx.lead.update({
      where: { id: leadId },
      data: { status: LeadStatus.WAITING_ASSIGNMENT, currentBrokerId: null },
    });
    await tx.auditLog.create({
      data: {
        organizationId,
        leadId,
        action: AuditAction.STATUS_CHANGED,
        entityType: "lead",
        entityId: leadId,
        metadata: { reason: "no_eligible_broker" },
      },
    });
    return null;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + params.timeoutMinutes * 60 * 1000);

  const assignment = await tx.leadAssignment.create({
    data: {
      organizationId,
      leadId,
      brokerId: picked.broker.id,
      attemptNumber,
      assignedAt: now,
      expiresAt,
      status: AssignmentStatus.ASSIGNED,
    },
  });

  await tx.lead.update({
    where: { id: leadId },
    data: { status: LeadStatus.ASSIGNED, currentBrokerId: picked.broker.id },
  });

  await tx.rotationState.update({
    where: { organizationId },
    data: { currentPosition: picked.newPosition },
  });

  await tx.auditLog.create({
    data: {
      organizationId,
      leadId,
      action: AuditAction.ASSIGNED,
      entityType: "lead_assignment",
      entityId: assignment.id,
      metadata: { brokerId: picked.broker.id, attemptNumber, expiresAt: expiresAt.toISOString() },
    },
  });

  return assignment;
}

/**
 * Distribui um lead recém-criado (novo lead do Meta ou criado manualmente).
 * Ponto de entrada público — abre a própria transação e bloqueia rotation_state.
 */
export async function distributeNewLead(organizationId: string, leadId: string) {
  return prisma.$transaction(
    async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });

      // Lock pessimista na linha de rotation_state da organização: serializa distribuições
      // concorrentes (dois leads chegando ao mesmo tempo) para essa organização.
      await tx.$queryRaw`SELECT id FROM rotation_state WHERE organization_id = ${organizationId} FOR UPDATE`;

      return assignNextLead(tx, {
        organizationId,
        leadId,
        timeoutMinutes: org.responseTimeoutMinutes,
      });
    },
    TX_OPTIONS
  );
}

/**
 * Ação "ENTRAR EM CONTATO" — operação atômica que só permite exatamente UM corretor
 * assumir o lead (seção 7 do escopo). Bloqueia a linha da tentativa ativa (FOR UPDATE) e
 * revalida tudo (status, corretor, prazo) dentro da mesma transação antes de gravar a mudança.
 */
export async function claimLead(params: { organizationId: string; leadId: string; brokerId: string }) {
  const { organizationId, leadId, brokerId } = params;

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM lead_assignments
      WHERE lead_id = ${leadId} AND organization_id = ${organizationId} AND status = 'ASSIGNED'
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new ClaimError("NOT_FOUND", "Este lead não possui uma atribuição ativa no momento.");
    }

    const assignment = await tx.leadAssignment.findUniqueOrThrow({ where: { id: rows[0].id } });

    if (assignment.brokerId !== brokerId) {
      throw new ClaimError("WRONG_BROKER", "Este lead já foi assumido por outro corretor.");
    }

    if (assignment.status !== AssignmentStatus.ASSIGNED) {
      throw new ClaimError("ALREADY_HANDLED", "Este lead já foi respondido.");
    }

    if (assignment.expiresAt.getTime() <= Date.now()) {
      throw new ClaimError("EXPIRED", "Este lead expirou e foi transferido.");
    }

    const now = new Date();

    const updatedAssignment = await tx.leadAssignment.update({
      where: { id: assignment.id },
      data: { status: AssignmentStatus.CONTACTED, respondedAt: now, responseType: "CONTACTED" },
    });

    const currentLead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });

    await tx.lead.update({
      where: { id: leadId },
      data: {
        status: LeadStatus.IN_PROGRESS,
        firstContactAt: currentLead.firstContactAt ?? now,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        leadId,
        action: AuditAction.CONTACTED,
        entityType: "lead_assignment",
        entityId: assignment.id,
        metadata: { brokerId },
      },
    });

    return updatedAssignment;
  }, TX_OPTIONS);
}

/**
 * Chamado pelo worker de expiração para UMA tentativa específica. Reabre o lock e
 * revalida antes de expirar — se um claim concorrente já resolveu a tentativa
 * (ou outra rodada do worker já processou), esta chamada não faz nada (idempotência,
 * seções 57/58 do escopo).
 */
export async function expireAndRotate(assignmentId: string) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM lead_assignments WHERE id = ${assignmentId} FOR UPDATE
    `;
    if (rows.length === 0) return { expired: false as const };

    const assignment = await tx.leadAssignment.findUniqueOrThrow({ where: { id: assignmentId } });

    if (assignment.status !== AssignmentStatus.ASSIGNED || assignment.expiresAt.getTime() > Date.now()) {
      return { expired: false as const };
    }

    await tx.leadAssignment.update({
      where: { id: assignment.id },
      data: { status: AssignmentStatus.EXPIRED },
    });

    await tx.auditLog.create({
      data: {
        organizationId: assignment.organizationId,
        leadId: assignment.leadId,
        action: AuditAction.EXPIRED,
        entityType: "lead_assignment",
        entityId: assignment.id,
        metadata: { brokerId: assignment.brokerId },
      },
    });

    await tx.$queryRaw`SELECT id FROM rotation_state WHERE organization_id = ${assignment.organizationId} FOR UPDATE`;

    const org = await tx.organization.findUniqueOrThrow({ where: { id: assignment.organizationId } });

    const next = await assignNextLead(tx, {
      organizationId: assignment.organizationId,
      leadId: assignment.leadId,
      timeoutMinutes: org.responseTimeoutMinutes,
    });

    await tx.auditLog.create({
      data: {
        organizationId: assignment.organizationId,
        leadId: assignment.leadId,
        action: AuditAction.TRANSFERRED,
        entityType: "lead",
        entityId: assignment.leadId,
        metadata: { fromBrokerId: assignment.brokerId, toBrokerId: next?.brokerId ?? null },
      },
    });

    return { expired: true as const, nextAssignment: next };
  }, TX_OPTIONS);
}

/** Usado pelo worker: lista os IDs de tentativas vencidas prontas para expirar. */
export async function findExpiredAssignmentIds(limit = 50): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM lead_assignments
    WHERE status = 'ASSIGNED' AND expires_at <= now()
    ORDER BY expires_at ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

import { prisma } from "./index";
import { AssignmentStatus, LeadStatus, AuditAction } from "@prisma/client";
import type { Prisma, LeadAssignment } from "@prisma/client";
import { notifyBrokerNewAssignment, notifyBrokerExpired, hasActiveWhatsAppIntegration } from "./whatsapp";

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
 * Escolhe o próximo corretor elegível a partir da posição imediatamente acima de
 * `afterPosition` no ranking (rotation_position), com wraparound para o topo quando
 * ultrapassa o último. `afterPosition = 0` sempre resolve para o corretor #1 do ranking.
 * Corretores pausados/inativos são simplesmente pulados (seção 45 do escopo).
 */
async function pickNextBroker(tx: Tx, organizationId: string, afterPosition: number) {
  const eligible = await tx.broker.findMany({
    where: { organizationId, status: "ACTIVE", isInRotation: true },
    orderBy: { rotationPosition: "asc" },
  });

  if (eligible.length === 0) return null;

  const next = eligible.find((b) => b.rotationPosition > afterPosition) ?? eligible[0];

  return { broker: next };
}

/**
 * Cria uma nova tentativa de atribuição (lead_assignment) para o próximo corretor elegível
 * e avança a escalação DESTE lead.
 *
 * Dois ponteiros diferentes decidem "próximo corretor", a depender do motivo da chamada:
 * - Lead NOVO (primeira tentativa): usa o ponteiro GLOBAL da organização
 *   (`rotation_state.current_position`) como ponto de partida, e o avança para a posição
 *   do corretor escolhido. Isso faz o 1º lead ir pro corretor #1, o 2º pro #2, o 3º pro #3
 *   etc., abastecendo todo mundo em ordem em vez de sempre começar do topo — critério de
 *   justiça pedido explicitamente (leads novos não podem se acumular só no #1).
 * - ESCALAÇÃO (tentativa anterior deste mesmo lead expirou sem resposta): usa a posição do
 *   corretor da última tentativa DESTE lead, nunca o ponteiro global — cada lead mantém sua
 *   própria cadeia de escalação a partir de onde ele começou, e escalar um lead não pode
 *   "roubar" a vez de um lead novo que ainda vai chegar.
 *
 * Em ambos os casos, `pickNextBroker` aplica o mesmo wraparound (volta pro topo do ranking
 * ao passar do último) e pula corretor pausado/inativo.
 *
 * Deve ser chamada dentro de uma transação que já tenha bloqueado (FOR UPDATE) a linha de
 * rotation_state da organização, para serializar atribuições concorrentes (seção 7 do escopo).
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
  const isNewLead = !lastAttempt;

  let afterPosition = 0;
  if (isNewLead) {
    const rotationState = await tx.rotationState.findUnique({ where: { organizationId } });
    afterPosition = rotationState?.currentPosition ?? 0;
  } else {
    const lastBroker = await tx.broker.findUnique({
      where: { id: lastAttempt.brokerId },
      select: { rotationPosition: true },
    });
    afterPosition = lastBroker?.rotationPosition ?? 0;
  }

  const picked = await pickNextBroker(tx, organizationId, afterPosition);

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

  // Só um lead NOVO avança o ponteiro global — escalação de um lead existente não deve
  // afetar onde o próximo lead novo vai cair.
  if (isNewLead) {
    await tx.rotationState.update({
      where: { organizationId },
      data: { currentPosition: picked.broker.rotationPosition },
    });
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
 * Verdadeiro só na primeira vez que ESTE corretor recebe ESTE lead. Se a roleta der uma
 * volta completa (ninguém responde e o ranking cicla de volta ao topo — ver pickNextBroker),
 * o mesmo corretor pode reaparecer numa tentativa posterior do mesmo lead; sem essa checagem,
 * ele levaria um novo WhatsApp a cada volta, virando um flood enquanto ninguém responder.
 */
async function isFirstAttemptForBroker(leadId: string, brokerId: string, attemptNumber: number): Promise<boolean> {
  const priorAttempt = await prisma.leadAssignment.findFirst({
    where: { leadId, brokerId, attemptNumber: { lt: attemptNumber } },
    select: { id: true },
  });
  return !priorAttempt;
}

/**
 * Notifica o corretor recém-atribuído por WhatsApp. Chamada sempre FORA da transação
 * (depois do commit) — nunca faz chamada de rede externa dentro de uma transação
 * interativa do Postgres. Best-effort: erros ficam só nos logs/audit_logs de whatsapp.ts,
 * nunca propagam para quem chamou (a atribuição já está gravada e vale independente
 * do WhatsApp ter saído ou não). Se a roleta já tinha passado por este corretor antes
 * (volta completa sem ninguém responder), envia o template RETURNED em vez do de "novo
 * lead" — assim ele ainda é avisado a cada volta, mas com uma mensagem diferente, não um
 * flood da mesma mensagem repetida (ver isFirstAttemptForBroker).
 */
async function notifyAssignmentCreated(organizationId: string, assignment: LeadAssignment) {
  if (!(await hasActiveWhatsAppIntegration(organizationId))) return;

  const [broker, lead, org, isFirst] = await Promise.all([
    prisma.broker.findUnique({ where: { id: assignment.brokerId } }),
    prisma.lead.findUnique({ where: { id: assignment.leadId } }),
    prisma.organization.findUnique({ where: { id: organizationId } }),
    isFirstAttemptForBroker(assignment.leadId, assignment.brokerId, assignment.attemptNumber),
  ]);
  if (!broker || !lead || !org) return;

  await notifyBrokerNewAssignment({
    organizationId,
    leadId: lead.id,
    brokerPhone: broker.phone,
    brokerName: broker.displayName,
    leadName: lead.name,
    leadPhone: lead.phone,
    timeoutMinutes: org.responseTimeoutMinutes,
    isReturning: !isFirst,
  });
}

/**
 * Avisa por WhatsApp o corretor que deixou o prazo esgotar sem responder (mesma regra de
 * best-effort acima). Também só na primeira vez que este corretor vê este lead — se a
 * roleta já tinha passado por ele antes (volta completa), ele já foi avisado uma vez sobre
 * esse lead e não precisa levar um segundo "expirou" a cada nova volta.
 */
async function notifyAssignmentExpired(assignment: LeadAssignment) {
  if (!(await hasActiveWhatsAppIntegration(assignment.organizationId))) return;
  if (!(await isFirstAttemptForBroker(assignment.leadId, assignment.brokerId, assignment.attemptNumber))) return;

  const [broker, lead] = await Promise.all([
    prisma.broker.findUnique({ where: { id: assignment.brokerId } }),
    prisma.lead.findUnique({ where: { id: assignment.leadId } }),
  ]);
  if (!broker || !lead) return;

  await notifyBrokerExpired({
    organizationId: assignment.organizationId,
    leadId: lead.id,
    brokerPhone: broker.phone,
    brokerName: broker.displayName,
    leadName: lead.name,
  });
}

/**
 * Distribui um lead recém-criado (novo lead do Meta ou criado manualmente).
 * Ponto de entrada público — abre a própria transação e bloqueia rotation_state.
 */
export async function distributeNewLead(organizationId: string, leadId: string) {
  const assignment = await prisma.$transaction(
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

  if (assignment) {
    await notifyAssignmentCreated(organizationId, assignment);
  }

  return assignment;
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
  const result = await prisma.$transaction(async (tx) => {
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

    return { expired: true as const, expiredAssignment: assignment, nextAssignment: next };
  }, TX_OPTIONS);

  if (result.expired) {
    await notifyAssignmentExpired(result.expiredAssignment);
    if (result.nextAssignment) {
      await notifyAssignmentCreated(result.expiredAssignment.organizationId, result.nextAssignment);
    }
  }

  return result;
}

/** Usado pelo worker: lista os IDs de tentativas vencidas prontas para expirar. */
export async function findExpiredAssignmentIds(limit = 50, organizationId?: string): Promise<string[]> {
  const rows = organizationId
    ? await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM lead_assignments
        WHERE status = 'ASSIGNED' AND expires_at <= now() AND organization_id = ${organizationId}
        ORDER BY expires_at ASC
        LIMIT ${limit}
      `
    : await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM lead_assignments
        WHERE status = 'ASSIGNED' AND expires_at <= now()
        ORDER BY expires_at ASC
        LIMIT ${limit}
      `;
  return rows.map((r) => r.id);
}

/**
 * Rede de segurança contra a ausência (ou queda) do worker dedicado (`worker/`): varre e
 * expira/rotaciona as tentativas vencidas de UMA organização. Pensada para ser chamada,
 * best-effort, no início das rotas GET que já são consultadas em polling curto pelo
 * frontend (dashboard "Ao vivo", "meus leads" do corretor) — assim a rotação avança mesmo
 * se o processo `worker/` não estiver implantado, desde que alguém esteja com uma tela
 * aberta. Não substitui o worker: com o app fechado por todos, nada aciona esta varredura.
 */
export async function sweepOrganizationExpirations(organizationId: string) {
  const ids = await findExpiredAssignmentIds(50, organizationId);
  for (const id of ids) {
    try {
      await expireAndRotate(id);
    } catch (error) {
      console.error("[rotation] falha ao expirar/rotacionar tentativa", id, error);
    }
  }
}

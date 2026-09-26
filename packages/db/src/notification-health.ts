import { prisma } from "./index";
import { isQuietHours } from "./quiet-hours";

export type NotificationIssue = {
  severity: "critical" | "warning";
  title: string;
  detail: string;
};

const MINUTE = 60 * 1000;

const OUTCOME_LABEL: Record<string, string> = {
  not_configured: "o servidor está sem as chaves de push (VAPID)",
  no_devices: "o corretor não tem nenhum aparelho com notificação ativada",
  all_failed: "o serviço de push recusou o envio para todos os aparelhos do corretor",
  broker_inactive: "o usuário do corretor está inativo",
  error: "erro inesperado no envio",
};

/**
 * Checagem de saúde das notificações de UMA organização — alimenta o alerta vermelho no
 * topo do painel do dono. Existe porque a pior falha possível do sistema é silenciosa: a
 * roleta continua girando, mas o corretor da vez não fica sabendo. Aqui cada forma
 * conhecida dessa falha vira um aviso explícito. O canal oficial de aviso aos corretores é o
 * push do app instalado na tela inicial (PWA) — o WhatsApp fica de fora deste alerta.
 *
 * 1. Aviso de vez que falhou (PUSH_FAILED) — diz o motivo e em qual processo (app/worker).
 * 2. Passagem da roleta SEM registro de aviso — o processo que girou a roleta está rodando
 *    código antigo (não registra envio) ou caiu no meio. Foi exatamente o incidente de
 *    26/09: o worker do Railway girava a roleta sem mandar push.
 * 3. Tentativas vencidas há mais de 2 min sem rotacionar — o worker está parado.
 * 4. Corretor ativo na roleta sem nenhum aparelho inscrito — nunca vai receber push.
 */
export async function getNotificationHealth(organizationId: string, now = new Date()): Promise<NotificationIssue[]> {
  const issues: NotificationIssue[] = [];
  const since = new Date(now.getTime() - 2 * 60 * MINUTE);

  const [failures, recentAssignments, stalled, brokers] = await Promise.all([
    prisma.auditLog.findMany({
      where: { organizationId, action: "PUSH_FAILED", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { metadata: true, createdAt: true },
    }),
    // Tentativas criadas nas últimas 2h com pelo menos 2 min de idade (tempo de sobra pro
    // envio ter terminado e sido registrado).
    prisma.leadAssignment.findMany({
      where: { organizationId, assignedAt: { gte: since, lte: new Date(now.getTime() - 2 * MINUTE) } },
      select: { id: true, assignedAt: true },
    }),
    prisma.leadAssignment.count({
      where: { organizationId, status: "ASSIGNED", expiresAt: { lt: new Date(now.getTime() - 2 * MINUTE) } },
    }),
    prisma.broker.findMany({
      where: { organizationId, status: "ACTIVE", isInRotation: true },
      select: { displayName: true, user: { select: { _count: { select: { pushSubscriptions: true } } } } },
    }),
  ]);

  // 1. Falhas registradas
  if (failures.length > 0) {
    const byReason = new Map<string, { count: number; processes: Set<string> }>();
    for (const f of failures) {
      const meta = f.metadata as { outcome?: string; process?: string };
      const key = meta.outcome ?? "error";
      const entry = byReason.get(key) ?? { count: 0, processes: new Set() };
      entry.count += 1;
      if (meta.process) entry.processes.add(meta.process);
      byReason.set(key, entry);
    }
    for (const [reason, { count, processes }] of byReason) {
      const where = processes.size > 0 ? ` (processo: ${[...processes].join(", ")})` : "";
      issues.push({
        severity: reason === "no_devices" ? "warning" : "critical",
        title: `${count} aviso(s) de vez não entregue(s) nas últimas 2h`,
        detail: `Motivo: ${OUTCOME_LABEL[reason] ?? reason}${where}.`,
      });
    }
  }

  // 2. Passagens da roleta sem registro de aviso (fora do horário de silêncio)
  const candidates = recentAssignments.filter((a) => !isQuietHours(a.assignedAt));
  if (candidates.length > 0) {
    const recorded = await prisma.auditLog.findMany({
      where: {
        organizationId,
        action: { in: ["PUSH_SENT", "PUSH_FAILED"] },
        entityType: "push_turn",
        entityId: { in: candidates.map((a) => a.id) },
      },
      select: { entityId: true },
    });
    const recordedIds = new Set(recorded.map((r) => r.entityId));
    const missing = candidates.filter((a) => !recordedIds.has(a.id)).length;
    if (missing > 0) {
      issues.push({
        severity: "critical",
        title: `${missing} passagem(ns) da roleta sem aviso para o corretor nas últimas 2h`,
        detail:
          "O lead passou para o próximo corretor, mas nenhum aviso foi disparado. Normalmente é o worker do Railway rodando uma versão antiga: faça um novo deploy dele (Railway → crmprospera-worker → Deploy).",
      });
    }
  }

  // 3. Roleta travada
  if (stalled > 0) {
    issues.push({
      severity: "critical",
      title: "A roleta está travada",
      detail: `${stalled} lead(s) com prazo vencido há mais de 2 min sem passar para o próximo corretor. O worker do Railway provavelmente está parado.`,
    });
  }

  // 4. Corretores sem aparelho inscrito
  const withoutDevice = brokers.filter((b) => b.user._count.pushSubscriptions === 0).map((b) => b.displayName);
  if (withoutDevice.length > 0) {
    issues.push({
      severity: "warning",
      title: `${withoutDevice.length} corretor(es) na roleta sem notificação ativada`,
      detail: `${withoutDevice.join(", ")} não vão receber push. Peça para abrirem o CRM no celular e tocarem em "Ativar notificações".`,
    });
  }

  return issues;
}

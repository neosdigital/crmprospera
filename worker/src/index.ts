import cron from "node-cron";

// Identifica este processo nos registros de envio de push (audit_log PUSH_SENT/PUSH_FAILED),
// pra o alerta do painel conseguir dizer "o WORKER está sem as chaves", e não só "falhou".
process.env.CRM_PROCESS_NAME = "worker";

import { findExpiredAssignmentIds, expireAndRotate, prisma, isPushConfigured } from "@crm/db";

const intervalSeconds = Number(process.env.EXPIRATION_CHECK_INTERVAL_SECONDS ?? 15);

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), scope: "EXPIRATION", event, ...data }));
}

/**
 * Varredura idempotente: busca tentativas ASSIGNED vencidas e, para cada uma, tenta
 * expirá-la e girar a roleta dentro de uma transação com lock (ver packages/db/src/rotation.ts).
 * Se uma corrida (claim concorrente ou execução anterior do worker) já resolveu a
 * tentativa, expireAndRotate simplesmente não faz nada — seguro rodar em paralelo/repetido.
 */
async function sweep() {
  const ids = await findExpiredAssignmentIds(100);
  if (ids.length === 0) return;

  log("sweep_start", { count: ids.length });

  for (const id of ids) {
    try {
      const result = await expireAndRotate(id);
      if (result.expired) {
        log("assignment_expired", {
          assignmentId: id,
          nextBrokerId: result.nextAssignment?.brokerId ?? null,
          transferred: Boolean(result.nextAssignment),
        });
      }
    } catch (error) {
      log("assignment_expire_error", { assignmentId: id, error: String(error) });
    }
  }
}

// Cadência configurável em segundos (default 15s); node-cron precisa de expressão cron,
// então convertemos o intervalo em "*/N * * * * *" (segundos) quando N < 60.
const cronExpression = intervalSeconds < 60 ? `*/${intervalSeconds} * * * * *` : `*/${Math.round(intervalSeconds / 60)} * * * *`;

log("worker_started", {
  intervalSeconds,
  cronExpression,
  pushConfigured: isPushConfigured(),
  commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
});
if (!isPushConfigured()) {
  // Sem as chaves, TODA passagem da roleta feita por este worker sai sem aviso pro corretor.
  // O painel do dono também mostra isso (alerta de notificações), mas deixa gritante no log.
  log("PUSH_NOT_CONFIGURED", {
    error: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT ausentes — corretores NÃO serão notificados nas passagens da roleta",
  });
}

cron.schedule(cronExpression, () => {
  sweep().catch((error) => log("sweep_fatal_error", { error: String(error) }));
});

async function shutdown() {
  log("worker_shutdown");
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

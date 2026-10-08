import { sendSystemAlert, WHATSAPP_TEMPLATES } from "@crm/db";

const url = process.env.HEALTHCHECK_URL || "https://crmprospera.vercel.app";
const alertPhone = process.env.HEALTHCHECK_ALERT_PHONE;
const failureThreshold = Number(process.env.HEALTHCHECK_FAILURE_THRESHOLD ?? 3);
const timeoutMs = 10_000;

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), scope: "HEALTHCHECK", event, ...data }));
}

function formatTime(date: Date): string {
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatDowntime(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest > 0 ? ` ${rest}min` : ""}`;
}

/**
 * Considera "fora do ar" apenas 402 (DEPLOYMENT_DISABLED — suspensão de billing na
 * Vercel, o caso real que motivou isso) e 5xx. Qualquer outra resposta (200, redirect
 * pro /login, até um 404) significa que a aplicação respondeu, então está "no ar" —
 * esse healthcheck não é um teste de corretude da aplicação, só de disponibilidade.
 */
async function checkOnce(): Promise<{ ok: boolean; reason: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 402) return { ok: false, reason: "Pagamento pendente na Vercel (402 Deployment Disabled)" };
    if (res.status >= 500) return { ok: false, reason: `Erro do servidor (HTTP ${res.status})` };
    return { ok: true, reason: "" };
  } catch (error) {
    return { ok: false, reason: `Falha de conexão: ${String((error as Error).message ?? error)}` };
  }
}

let consecutiveFailures = 0;
let isDown = false;
let downSince: Date | null = null;

/**
 * Chamado pelo cron do worker. Só alerta na TRANSIÇÃO de estado (ficou indisponível
 * por `failureThreshold` checagens seguidas, ou voltou depois de ter caído) — nunca
 * manda um WhatsApp por checagem, senão vira spam a cada minuto enquanto durar a queda.
 */
export async function runHealthcheck() {
  if (!alertPhone) return;

  const { ok, reason } = await checkOnce();

  if (!ok) {
    consecutiveFailures += 1;
    log("check_failed", { consecutiveFailures, reason });

    if (!isDown && consecutiveFailures >= failureThreshold) {
      isDown = true;
      downSince = new Date();
      log("alerting_down", { reason });
      try {
        await sendSystemAlert({
          to: alertPhone,
          templateName: WHATSAPP_TEMPLATES.SYSTEM_DOWN.name,
          bodyParams: [formatTime(downSince), reason],
        });
      } catch (error) {
        log("alert_send_error", { error: String(error) });
      }
    }
    return;
  }

  if (isDown && downSince) {
    const downtimeMs = Date.now() - downSince.getTime();
    log("alerting_recovered", { downtimeMs });
    try {
      await sendSystemAlert({
        to: alertPhone,
        templateName: WHATSAPP_TEMPLATES.SYSTEM_RECOVERED.name,
        bodyParams: [formatTime(new Date()), formatDowntime(downtimeMs)],
      });
    } catch (error) {
      log("alert_send_error", { error: String(error) });
    }
  }

  consecutiveFailures = 0;
  isDown = false;
  downSince = null;
}

/**
 * Horário de silêncio das notificações (fora do horário de atendimento): das 23h às 07h,
 * no fuso de Brasília — independente do fuso do servidor (Railway roda em UTC).
 * Só silencia os avisos (WhatsApp, som, notificação do navegador); a roleta, os prazos
 * e as expirações continuam rodando normalmente.
 *
 * Mantenha em sincronia com app/src/lib/quiet-hours.ts (cópia usada no navegador, que não
 * pode importar @crm/db porque o pacote carrega o Prisma).
 */
export const QUIET_HOURS_START = 23;
export const QUIET_HOURS_END = 7;
export const QUIET_HOURS_TIMEZONE = "America/Sao_Paulo";

export function isQuietHours(date: Date = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: QUIET_HOURS_TIMEZONE }).format(date)
  );
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

/**
 * Horário de silêncio das notificações (fora do horário de atendimento): das 23h às 07h,
 * no horário de Brasília — independente do fuso do servidor (Railway e Vercel rodam em UTC).
 * Só silencia os avisos (WhatsApp, som, notificação do navegador); a roleta, os prazos
 * e as expirações continuam rodando normalmente.
 *
 * Mantenha em sincronia com app/src/lib/quiet-hours.ts (cópia usada no navegador, que não
 * pode importar @crm/db porque o pacote carrega o Prisma).
 */
export const QUIET_HOURS_START = 23;
export const QUIET_HOURS_END = 7;

// Brasília é UTC-3 fixo (sem horário de verão desde 2019). Cálculo aritmético de propósito,
// sem Intl/timeZone: se o runtime não tiver dados de fuso (Node com small-icu), um RangeError
// aqui derrubaria o envio das notificações — que é justamente o que não pode acontecer.
const BRASILIA_UTC_OFFSET_HOURS = -3;

export function brasiliaHour(date: Date = new Date()): number {
  return (date.getUTCHours() + BRASILIA_UTC_OFFSET_HOURS + 24) % 24;
}

export function isQuietHours(date: Date = new Date()): boolean {
  const hour = brasiliaHour(date);
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

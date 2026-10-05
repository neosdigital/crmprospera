/**
 * Lado do navegador do retorno agendado de leads perdidos. A data em si é calculada e salva
 * pelo servidor (packages/db/src/lost-return.ts) — aqui só ficam as opções da pergunta e a
 * formatação do contador do card. Limites espelham LOST_RETURN_LIMITS do servidor, que
 * revalida tudo de qualquer forma.
 */
export type LostReturnPeriod = { unit: "weeks" | "months"; amount: number };

export const LOST_RETURN_PRESETS: { label: string; period: LostReturnPeriod }[] = [
  { label: "1 semana", period: { unit: "weeks", amount: 1 } },
  { label: "1 mês", period: { unit: "months", amount: 1 } },
  { label: "5 meses", period: { unit: "months", amount: 5 } },
];

export const LOST_RETURN_MAX_MONTHS = 60;

const DAY = 24 * 60 * 60 * 1000;

/** "28 dias", "1 mês", "3 meses", "5 horas"... até a data (null se já passou). */
function formatRemaining(target: Date, now: Date): string | null {
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return null;

  const days = diff / DAY;
  if (days >= 60) return `${Math.floor(days / 30)} meses`;
  if (days >= 30) return "1 mês";
  if (days >= 2) return `${Math.floor(days)} dias`;
  if (days >= 1) return "1 dia";

  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours >= 2) return `${hours} horas`;
  if (hours === 1) return "1 hora";
  const minutes = Math.max(1, Math.ceil(diff / (60 * 1000)));
  return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
}

/** Card em "Perdido": "28 dias para ir à roleta", "1 mês para ir à roleta"... */
export function formatTimeUntilReturn(returnAt: Date, now: Date = new Date()): string {
  const remaining = formatRemaining(returnAt, now);
  return remaining ? `${remaining} para ir à roleta` : "Voltando para a roleta...";
}

/** Card em "Remarketing": "7 dias para o lembrete"... */
export function formatTimeUntilReminder(notifyAt: Date, now: Date = new Date()): string {
  const remaining = formatRemaining(notifyAt, now);
  return remaining ? `${remaining} para o lembrete` : "Enviando lembrete...";
}

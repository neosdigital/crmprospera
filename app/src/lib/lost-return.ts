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

/** "28 dias para ir à roleta", "1 mês para ir à roleta", "3 meses para ir à roleta"... */
export function formatTimeUntilReturn(returnAt: Date, now: Date = new Date()): string {
  const diff = returnAt.getTime() - now.getTime();
  if (diff <= 0) return "Voltando para a roleta...";

  const days = diff / DAY;
  if (days >= 60) return `${Math.floor(days / 30)} meses para ir à roleta`;
  if (days >= 30) return "1 mês para ir à roleta";
  if (days >= 2) return `${Math.floor(days)} dias para ir à roleta`;
  if (days >= 1) return "1 dia para ir à roleta";

  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours >= 2) return `${hours} horas para ir à roleta`;
  if (hours === 1) return "1 hora para ir à roleta";
  const minutes = Math.max(1, Math.ceil(diff / (60 * 1000)));
  return minutes === 1 ? "1 minuto para ir à roleta" : `${minutes} minutos para ir à roleta`;
}

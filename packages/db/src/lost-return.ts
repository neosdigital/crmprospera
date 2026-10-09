/**
 * Prazo escolhido ao mover um lead para "Perdidos" ("Em quanto tempo esse lead volta para a
 * roleta?"). A data de retorno é SEMPRE calculada no servidor a partir deste período — o
 * navegador nunca manda uma data pronta — e fica salva em leads.return_to_rotation_at.
 */
export type LostReturnPeriod = { unit: "weeks" | "months"; amount: number };

export const LOST_RETURN_LIMITS = { weeks: 52, months: 60 } as const;

/** Mensagem de erro em português, ou null se o período é válido. */
export function validateLostReturnPeriod(period: LostReturnPeriod): string | null {
  if (!Number.isInteger(period.amount) || period.amount < 1) {
    return "Informe um período de pelo menos 1.";
  }
  const max = LOST_RETURN_LIMITS[period.unit];
  if (period.amount > max) {
    return period.unit === "months" ? `O período máximo é de ${max} meses.` : `O período máximo é de ${max} semanas.`;
  }
  return null;
}

/**
 * Soma o período à data, mantendo o horário. Meses respeitam o fim do mês (31/01 + 1 mês =
 * 28/02 ou 29/02), para nunca gerar data impossível ou "pular" um mês.
 */
export function computeLostReturnAt(from: Date, period: LostReturnPeriod): Date {
  const error = validateLostReturnPeriod(period);
  if (error) throw new Error(error);

  if (period.unit === "weeks") {
    return new Date(from.getTime() + period.amount * 7 * 24 * 60 * 60 * 1000);
  }

  const result = new Date(from.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + period.amount);
  const lastDayOfTargetMonth = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return result;
}

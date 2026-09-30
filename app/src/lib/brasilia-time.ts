/**
 * Datas no horário de Brasília, independente do fuso de quem executa. A Vercel (e o Railway)
 * rodam em UTC — 3h à frente de Brasília —, então qualquer `new Date(y, m, d)`, `getHours()`
 * ou `format()` executado no SERVIDOR sai deslocado: o "Hoje" começava às 21h do dia
 * anterior e os horários da lista de leads apareciam 3h adiantados.
 *
 * Brasília é UTC-3 fixo (sem horário de verão desde 2019) — mesma premissa de quiet-hours.ts.
 * Sem dependências: funciona no servidor e no navegador.
 */
const OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Relógio "de parede" de Brasília: um Date cujos campos UTC são a data/hora local de Brasília. */
function wallClock(date: Date) {
  return new Date(date.getTime() + OFFSET_MS);
}

/** Instante em que começa (00:00 de Brasília) o dia em que `date` está. */
export function startOfBrasiliaDay(date: Date = new Date()): Date {
  const wall = wallClock(date);
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) - OFFSET_MS);
}

/** Dia de Brasília "YYYY-MM-DD" → { início 00:00:00.000, fim 23:59:59.999 } daquele dia. Null se inválido. */
export function brasiliaDayRange(ymd: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - OFFSET_MS);
  if (isNaN(start.getTime()) || wallClock(start).getUTCDate() !== d) return null;
  return { start, end: new Date(start.getTime() + DAY_MS - 1) };
}

/** Hoje em Brasília como "YYYY-MM-DD" (valor padrão de <input type="date">). */
export function todayBrasiliaISO(date: Date = new Date()): string {
  return wallClock(date).toISOString().slice(0, 10);
}

/** Formata no horário de Brasília. Tokens: dd, MM, yyyy, HH, mm, ss. */
export function formatBrasilia(date: Date | string, pattern: string): string {
  const wall = wallClock(typeof date === "string" ? new Date(date) : date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return pattern
    .replace("yyyy", String(wall.getUTCFullYear()))
    .replace("dd", pad(wall.getUTCDate()))
    .replace("MM", pad(wall.getUTCMonth() + 1))
    .replace("HH", pad(wall.getUTCHours()))
    .replace("mm", pad(wall.getUTCMinutes()))
    .replace("ss", pad(wall.getUTCSeconds()));
}

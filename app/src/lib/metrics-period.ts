import { brasiliaDayRange, startOfBrasiliaDay } from "@/lib/brasilia-time";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Período dos filtros do Dashboard do dono, sempre no dia de Brasília (o servidor roda em UTC):
 * - "today": de 00:00 de hoje (Brasília) até agora;
 * - "custom": from/to ("YYYY-MM-DD") de 00:00 do primeiro dia até 23:59:59 do último (Brasília);
 * - "7d" / "30d": janelas móveis a partir de agora (não dependem de fuso).
 */
export function resolveMetricsPeriod(
  searchParams: URLSearchParams,
  now: Date = new Date()
): { period: string; since: Date; until: Date } {
  const today = { period: "today", since: startOfBrasiliaDay(now), until: now };
  const period = searchParams.get("period") ?? "today";

  if (period === "custom") {
    const from = brasiliaDayRange(searchParams.get("from") ?? "");
    const to = brasiliaDayRange(searchParams.get("to") ?? "");
    if (from && to && from.start <= to.end) return { period, since: from.start, until: to.end };
    return today;
  }

  if (period === "7d") return { period, since: new Date(now.getTime() - 7 * DAY_MS), until: now };
  if (period === "30d") return { period, since: new Date(now.getTime() - 30 * DAY_MS), until: now };
  return today;
}

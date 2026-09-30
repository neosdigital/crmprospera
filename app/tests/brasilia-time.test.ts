import { describe, it, expect } from "vitest";
import { startOfBrasiliaDay, brasiliaDayRange, todayBrasiliaISO, formatBrasilia } from "../src/lib/brasilia-time";
import { resolveMetricsPeriod } from "../src/lib/metrics-period";

describe("Horário de Brasília (servidor roda em UTC)", () => {
  it('"Hoje" começa às 00:00 de Brasília — inclusive depois das 21h, quando o UTC já virou o dia', () => {
    // 30/09 22:30 em Brasília = 01/10 01:30 UTC
    const night = new Date("2026-10-01T01:30:00Z");
    expect(startOfBrasiliaDay(night).toISOString()).toBe("2026-09-30T03:00:00.000Z");
    // 30/09 10:00 em Brasília: o dia NÃO inclui as últimas horas de 29/09
    expect(startOfBrasiliaDay(new Date("2026-09-30T13:00:00Z")).toISOString()).toBe("2026-09-30T03:00:00.000Z");
    // 00:05 de Brasília: já é o dia novo
    expect(startOfBrasiliaDay(new Date("2026-09-30T03:05:00Z")).toISOString()).toBe("2026-09-30T03:00:00.000Z");
  });

  it("filtro personalizado cobre o dia inteiro de Brasília", () => {
    const range = brasiliaDayRange("2026-09-30")!;
    expect(range.start.toISOString()).toBe("2026-09-30T03:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-01T02:59:59.999Z");
    expect(brasiliaDayRange("2026-02-31")).toBeNull();
    expect(brasiliaDayRange("lixo")).toBeNull();
  });

  it("data padrão do filtro e formatação da lista de leads", () => {
    expect(todayBrasiliaISO(new Date("2026-10-01T01:30:00Z"))).toBe("2026-09-30");
    expect(formatBrasilia(new Date("2026-10-01T01:30:45Z"), "dd/MM HH:mm")).toBe("30/09 22:30");
    expect(formatBrasilia("2026-10-01T01:30:45Z", "dd/MM/yyyy HH:mm:ss")).toBe("30/09/2026 22:30:45");
  });

  it("período das métricas do Dashboard", () => {
    const now = new Date("2026-10-01T01:30:00Z"); // 30/09 22:30 em Brasília
    const today = resolveMetricsPeriod(new URLSearchParams("period=today"), now);
    expect(today.since.toISOString()).toBe("2026-09-30T03:00:00.000Z");
    expect(today.until).toBe(now);

    const custom = resolveMetricsPeriod(new URLSearchParams("period=custom&from=2026-09-01&to=2026-09-30"), now);
    expect(custom.since.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(custom.until.toISOString()).toBe("2026-10-01T02:59:59.999Z");

    // Intervalo invertido/ inválido cai para "Hoje"
    expect(resolveMetricsPeriod(new URLSearchParams("period=custom&from=2026-09-30&to=2026-09-01"), now).period).toBe("today");
  });
});

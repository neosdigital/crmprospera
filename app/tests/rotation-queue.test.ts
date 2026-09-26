import { describe, it, expect } from "vitest";
import { brokersAheadInRotation, isQuietHours, brasiliaHour } from "@crm/db";

describe("brokersAheadInRotation — quantos corretores faltam até a minha vez", () => {
  const all = [1, 2, 3, 4, 5, 6, 7];

  it("conta quem está com o lead + os elegíveis entre ele e mim", () => {
    expect(brokersAheadInRotation(all, 3, 5)).toBe(2); // #3 (agora) e #4
    expect(brokersAheadInRotation(all, 4, 5)).toBe(1); // só o #4
  });

  it("dá a volta no fim do ranking (wraparound)", () => {
    expect(brokersAheadInRotation(all, 6, 2)).toBe(3); // #6, #7, #1
  });

  it("pula corretores pausados (fora da lista de elegíveis)", () => {
    expect(brokersAheadInRotation([1, 2, 5, 7], 1, 7)).toBe(3); // #1, #2, #5
  });

  it("null quando estou pausado ou o lead já está comigo", () => {
    expect(brokersAheadInRotation([1, 2, 3], 1, 5)).toBeNull();
    expect(brokersAheadInRotation(all, 5, 5)).toBeNull();
  });
});

describe("isQuietHours — horário de Brasília sem depender de Intl", () => {
  it("usa UTC-3", () => {
    expect(brasiliaHour(new Date("2026-09-26T02:00:00Z"))).toBe(23);
    expect(brasiliaHour(new Date("2026-09-26T13:30:00Z"))).toBe(10);
  });

  it("silêncio de 23:00 até 06:59", () => {
    expect(isQuietHours(new Date("2026-09-26T01:59:59Z"))).toBe(false); // 22:59
    expect(isQuietHours(new Date("2026-09-26T02:00:00Z"))).toBe(true); // 23:00
    expect(isQuietHours(new Date("2026-09-26T09:59:59Z"))).toBe(true); // 06:59
    expect(isQuietHours(new Date("2026-09-26T10:00:00Z"))).toBe(false); // 07:00
  });
});

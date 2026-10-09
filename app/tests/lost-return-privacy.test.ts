import { describe, it, expect, afterEach, vi } from "vitest";
import webpush from "web-push";
import {
  prisma,
  distributeNewLead,
  computeLostReturnAt,
  validateLostReturnPeriod,
  returnLostLeadToRotation,
  findDueLostLeadIds,
} from "@crm/db";
import { createTestOrg, createTestLead, cleanupTestOrg } from "./helpers";
import { formatTimeUntilReturn } from "../src/lib/lost-return";
import { applyLeadContactPrivacy, maskEmail, maskPhone, maskContactCustomFields } from "../src/lib/lead-privacy";

vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }) },
  WebPushError: class extends Error {},
}));
process.env.VAPID_SUBJECT ??= "mailto:teste@example.com";
process.env.VAPID_PUBLIC_KEY ??= "chave-publica-de-teste";
process.env.VAPID_PRIVATE_KEY ??= "chave-privada-de-teste";

const cleanupIds: string[] = [];
afterEach(async () => {
  while (cleanupIds.length) await cleanupTestOrg(cleanupIds.pop()!);
});

describe("TESTE 1 — Privacidade do contato (regra aplicada no servidor)", () => {
  const lead = {
    currentBrokerId: "broker_B",
    phone: "+55 (47) 99988-7766",
    email: "joao.silva@gmail.com",
    customFields: { phone_number: "+5547999887766", email: "joao.silva@gmail.com", "Qual imóvel?": "Casa 3 quartos" },
  };

  it("corretor A vendo lead do corretor B: telefone, e-mail e respostas de contato saem mascarados", () => {
    const seen = applyLeadContactPrivacy({ role: "BROKER", brokerId: "broker_A" }, lead);
    expect(seen.contactProtected).toBe(true);
    expect(seen.phone).toBe("(47) 9****-****");
    expect(seen.email).toBe("j*****@gmail.com");
    const fields = seen.customFields as Record<string, string>;
    expect(fields.phone_number).toBe("(47) 9****-****");
    expect(fields.email).toBe("j*****@gmail.com");
    expect(fields["Qual imóvel?"]).toBe("Casa 3 quartos"); // informação geral continua visível
    expect(seen.protectedFieldKeys.sort()).toEqual(["email", "phone_number"]);
    // O valor completo não sobra em lugar nenhum do objeto que vai para o navegador.
    expect(JSON.stringify(seen)).not.toContain("99988");
    expect(JSON.stringify(seen)).not.toContain("joao.silva");
  });

  it("corretor vendo lead da própria carteira: tudo completo", () => {
    const seen = applyLeadContactPrivacy({ role: "BROKER", brokerId: "broker_B" }, lead);
    expect(seen.contactProtected).toBe(false);
    expect(seen.phone).toBe(lead.phone);
    expect(seen.email).toBe(lead.email);
  });

  it("gestor (dono/admin) vê tudo normalmente", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      const seen = applyLeadContactPrivacy({ role, brokerId: null }, lead);
      expect(seen.contactProtected).toBe(false);
      expect(seen.phone).toBe(lead.phone);
    }
  });

  it("máscaras em formatos variados", () => {
    expect(maskPhone("47999887766")).toBe("(47) 9****-****");
    expect(maskPhone("123")).toBe("(**) *****-****");
    expect(maskPhone(null)).toBeNull();
    expect(maskEmail("a@b.com")).toBe("a*****@b.com");
    expect(maskContactCustomFields({ "Seu melhor WhatsApp": "47 99999-1111" }).fields["Seu melhor WhatsApp"]).toBe(
      "(47) 9****-****"
    );
  });
});

describe("TESTES 3/4/6 — Prazo de retorno do lead perdido", () => {
  const base = new Date("2026-09-30T15:00:00Z");

  it("1 semana, 1 mês e 5 meses", () => {
    expect(computeLostReturnAt(base, { unit: "weeks", amount: 1 }).toISOString()).toBe("2026-10-07T15:00:00.000Z");
    expect(computeLostReturnAt(base, { unit: "months", amount: 1 }).toISOString()).toBe("2026-10-30T15:00:00.000Z");
    expect(computeLostReturnAt(base, { unit: "months", amount: 5 }).toISOString()).toBe("2027-02-28T15:00:00.000Z");
  });

  it("outro período: 3 meses", () => {
    expect(computeLostReturnAt(base, { unit: "months", amount: 3 }).toISOString()).toBe("2026-12-30T15:00:00.000Z");
  });

  it("fim de mês nunca gera data impossível (31/01 + 1 mês = 28/02)", () => {
    expect(computeLostReturnAt(new Date("2027-01-31T12:00:00Z"), { unit: "months", amount: 1 }).toISOString()).toBe(
      "2027-02-28T12:00:00.000Z"
    );
  });

  it("recusa zero, negativo, fracionado e acima do limite", () => {
    expect(validateLostReturnPeriod({ unit: "months", amount: 0 })).not.toBeNull();
    expect(validateLostReturnPeriod({ unit: "months", amount: -2 })).not.toBeNull();
    expect(validateLostReturnPeriod({ unit: "months", amount: 1.5 })).not.toBeNull();
    expect(validateLostReturnPeriod({ unit: "months", amount: 61 })).not.toBeNull();
    expect(validateLostReturnPeriod({ unit: "months", amount: 12 })).toBeNull();
    expect(() => computeLostReturnAt(base, { unit: "months", amount: 0 })).toThrow();
  });

  it("contador do card", () => {
    const now = new Date("2026-09-30T12:00:00Z");
    const plus = (ms: number) => new Date(now.getTime() + ms);
    const day = 24 * 60 * 60 * 1000;
    expect(formatTimeUntilReturn(plus(28 * day), now)).toBe("28 dias para ir à roleta");
    expect(formatTimeUntilReturn(plus(31 * day), now)).toBe("1 mês para ir à roleta");
    expect(formatTimeUntilReturn(plus(150 * day), now)).toBe("5 meses para ir à roleta");
    expect(formatTimeUntilReturn(plus(day + 1000), now)).toBe("1 dia para ir à roleta");
    expect(formatTimeUntilReturn(plus(5 * 60 * 60 * 1000), now)).toBe("5 horas para ir à roleta");
    expect(formatTimeUntilReturn(plus(-1000), now)).toBe("Voltando para a roleta...");
  });
});

describe("TESTE 5 — Retorno automático para a roleta existente", () => {
  // Datas de retorno SEMPRE no futuro real (e simuladas via parâmetro `now`), para o worker de
  // produção que varre o mesmo banco não pegar o lead antes do teste.
  const inTenDays = () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

  it("volta como o MESMO lead, com nova tentativa, histórico preservado e sem duplicar", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 3 });
    cleanupIds.push(org.id);
    const lead = await createTestLead(org.id, "Lead que voltou");
    const first = await distributeNewLead(org.id, lead.id);
    const returnAt = inTenDays();
    await prisma.leadAssignment.update({ where: { id: first!.id }, data: { status: "CONTACTED" } });
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "LOST", returnToRotationAt: returnAt } });

    // Antes da data: não volta.
    expect(await returnLostLeadToRotation(lead.id, new Date(returnAt.getTime() - 60_000))).toBeNull();

    const result = await returnLostLeadToRotation(lead.id, new Date(returnAt.getTime() + 60_000));
    expect(result?.assignment).toBeTruthy();

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.status).toBe("ASSIGNED");
    expect(after.returnToRotationAt).toBeNull();
    expect(await prisma.lead.count({ where: { organizationId: org.id } })).toBe(1);

    const attempts = await prisma.leadAssignment.findMany({ where: { leadId: lead.id }, orderBy: { attemptNumber: "asc" } });
    expect(attempts.map((a) => a.attemptNumber)).toEqual([1, 2]);
    expect(attempts[0].brokerId).toBe(brokers[0].id); // passagem antiga continua no histórico
    // Entra como lead novo na vez da roleta (ponteiro global já estava no #1 → vai pro #2).
    expect(attempts[1].brokerId).toBe(brokers[1].id);

    const log = await prisma.auditLog.findFirst({ where: { leadId: lead.id, action: "STATUS_CHANGED" } });
    expect(log?.metadata).toMatchObject({ reason: "lost_return_to_rotation" });

    // Idempotente: rodar de novo não cria outra tentativa.
    expect(await returnLostLeadToRotation(lead.id, new Date(returnAt.getTime() + 120_000))).toBeNull();
    expect(await prisma.leadAssignment.count({ where: { leadId: lead.id } })).toBe(2);
  });

  it("não volta se o lead saiu de Perdidos antes da data", async () => {
    const { org } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const lead = await createTestLead(org.id);
    const returnAt = inTenDays();
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "REMARKETING", returnToRotationAt: returnAt } });

    expect(await returnLostLeadToRotation(lead.id, new Date(returnAt.getTime() + 60_000))).toBeNull();
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("REMARKETING");
  });

  it("varredura encontra só os vencidos, e espera o fim do horário de silêncio", async () => {
    const { org } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const due = await createTestLead(org.id, "vence");
    const later = await createTestLead(org.id, "depois");
    const returnAt = inTenDays();
    returnAt.setUTCHours(14, 0, 0, 0); // 11h em Brasília
    await prisma.lead.update({ where: { id: due.id }, data: { status: "LOST", returnToRotationAt: returnAt } });
    await prisma.lead.update({
      where: { id: later.id },
      data: { status: "LOST", returnToRotationAt: new Date(returnAt.getTime() + 24 * 60 * 60 * 1000) },
    });

    const hour = 60 * 60 * 1000;
    // 12h em Brasília do dia do retorno: só o que já venceu.
    expect(await findDueLostLeadIds(50, org.id, new Date(returnAt.getTime() + hour))).toEqual([due.id]);
    // 01h em Brasília da madrugada seguinte (silêncio): ninguém volta ainda, espera as 07h.
    expect(await findDueLostLeadIds(50, org.id, new Date(returnAt.getTime() + 14 * hour))).toEqual([]);
    // 07h em Brasília: volta.
    expect(await findDueLostLeadIds(50, org.id, new Date(returnAt.getTime() + 20 * hour))).toEqual([due.id]);
  });
});

describe("TESTE 6 — Notificação com som respeita a preferência do corretor", () => {
  it("push leva silent=false com som ativado e silent=true com som desativado", async () => {
    const send = vi.mocked(webpush.sendNotification);
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const user = await prisma.broker.findUniqueOrThrow({ where: { id: brokers[0].id } });
    await prisma.pushSubscription.create({
      data: { organizationId: org.id, userId: user.userId, endpoint: `https://push.example.com/som-${org.id}`, p256dh: "k", auth: "a" },
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(18, 0, 0, 0); // 15h em Brasília (fora do silêncio)
    vi.setSystemTime(tomorrow);
    try {
      send.mockClear();
      await distributeNewLead(org.id, (await createTestLead(org.id, "com som")).id);
      expect(JSON.parse(String(send.mock.calls[0][1])).silent).toBe(false);

      await prisma.broker.update({ where: { id: brokers[0].id }, data: { soundEnabled: false } });
      send.mockClear();
      await distributeNewLead(org.id, (await createTestLead(org.id, "sem som")).id);
      expect(JSON.parse(String(send.mock.calls[0][1])).silent).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

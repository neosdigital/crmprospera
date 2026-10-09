import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma, distributeNewLead } from "@crm/db";
import { createTestOrg, createTestLead, cleanupTestOrg } from "./helpers";

// Sessão simulada: cada teste define quem está "logado" nas rotas reais da API.
const sessionRef: { current: unknown } = { current: null };
vi.mock("@/auth", () => ({ auth: vi.fn(async () => sessionRef.current) }));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }) },
  WebPushError: class extends Error {},
}));

import { GET as liveGET } from "../src/app/api/dashboard/live/route";
import { GET as leadGET } from "../src/app/api/leads/[id]/route";
import { POST as statusPOST } from "../src/app/api/leads/[id]/status/route";
import { GET as meGET, PATCH as mePATCH } from "../src/app/api/broker/me/route";

const cleanupIds: string[] = [];
afterEach(async () => {
  sessionRef.current = null;
  while (cleanupIds.length) await cleanupTestOrg(cleanupIds.pop()!);
});

async function loginAsBroker(organizationId: string, brokerId: string) {
  const broker = await prisma.broker.findUniqueOrThrow({ where: { id: brokerId } });
  sessionRef.current = { user: { id: broker.userId, role: "BROKER", organizationId, brokerId } };
}

function loginAsOwner(organizationId: string) {
  sessionRef.current = { user: { id: "owner-test", role: "OWNER", organizationId, brokerId: null } };
}

async function liveLeads() {
  const res = await liveGET();
  const body = (await res.json()) as { activeLeads: { id: string; phone: string; email: string; contactProtected: boolean }[] };
  return body;
}

describe("TESTE 1 (API real) — Ao Vivo não entrega contato de lead de outro corretor", () => {
  it("corretor A: lead do B vem mascarado na resposta HTTP; o próprio vem completo; gestor vê tudo", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 2 });
    cleanupIds.push(org.id);
    const [a, b] = brokers;

    const leadOfB = await prisma.lead.create({
      data: {
        organizationId: org.id,
        name: "Lead do B",
        phone: "+5547999887766",
        email: "cliente.b@gmail.com",
        status: "IN_PROGRESS",
        currentBrokerId: b.id,
        customFields: { phone_number: "+5547999887766" },
      },
    });
    const leadOfA = await prisma.lead.create({
      data: {
        organizationId: org.id,
        name: "Lead do A",
        phone: "+5547911112222",
        email: "cliente.a@gmail.com",
        status: "IN_PROGRESS",
        currentBrokerId: a.id,
      },
    });

    await loginAsBroker(org.id, a.id);
    const res = await liveGET();
    const raw = await res.text();
    // O valor completo do lead do B não aparece em NENHUM lugar da resposta (nem em DevTools/Network).
    expect(raw).not.toContain("999887766");
    expect(raw).not.toContain("cliente.b");
    const body = JSON.parse(raw) as { activeLeads: { id: string; phone: string; email: string; contactProtected: boolean }[] };
    const seenB = body.activeLeads.find((l) => l.id === leadOfB.id)!;
    expect(seenB).toMatchObject({ phone: "(47) 9****-****", email: "c*****@gmail.com", contactProtected: true });
    const seenA = body.activeLeads.find((l) => l.id === leadOfA.id)!;
    expect(seenA).toMatchObject({ phone: "+5547911112222", email: "cliente.a@gmail.com", contactProtected: false });

    loginAsOwner(org.id);
    const asOwner = await liveLeads();
    expect(asOwner.activeLeads.find((l) => l.id === leadOfB.id)).toMatchObject({
      phone: "+5547999887766",
      contactProtected: false,
    });
  });

  it("corretor que já passou pelo lead (hoje com outro) recebe contato mascarado em /api/leads/[id]", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 2 });
    cleanupIds.push(org.id);
    const lead = await prisma.lead.create({
      data: { organizationId: org.id, name: "Passou", phone: "+5547933334444", email: "x.y@gmail.com" },
    });
    await distributeNewLead(org.id, lead.id); // tentativa #1 com o corretor A
    await prisma.lead.update({ where: { id: lead.id }, data: { currentBrokerId: brokers[1].id } }); // agora é do B

    await loginAsBroker(org.id, brokers[0].id);
    const raw = await (await leadGET(new Request("http://test"), { params: Promise.resolve({ id: lead.id }) })).text();
    expect(raw).not.toContain("933334444");
    expect(JSON.parse(raw).lead).toMatchObject({ phone: "(47) 9****-****", contactProtected: true });
  });
});

describe("TESTES 2/3/4 (API real) — Remarketing e Perdidos com retorno", () => {
  async function move(leadId: string, body: unknown) {
    return statusPOST(
      new Request("http://test", { method: "POST", body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: leadId }) }
    );
  }

  it("move para Remarketing e mantém o lead na carteira do corretor", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const lead = await prisma.lead.create({
      data: { organizationId: org.id, name: "Remk", status: "IN_PROGRESS", currentBrokerId: brokers[0].id },
    });
    await loginAsBroker(org.id, brokers[0].id);

    expect((await move(lead.id, { status: "REMARKETING" })).status).toBe(200);
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ status: "REMARKETING", currentBrokerId: brokers[0].id });
  });

  it("Perdido com 1 semana salva a data calculada no servidor; outro período (3 meses) também; sair limpa", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const lead = await createTestLead(org.id);
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "IN_PROGRESS", currentBrokerId: brokers[0].id } });
    await loginAsBroker(org.id, brokers[0].id);

    const before = Date.now();
    expect((await move(lead.id, { status: "LOST", returnPeriod: { unit: "weeks", amount: 1 } })).status).toBe(200);
    let saved = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(saved.status).toBe("LOST");
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(saved.returnToRotationAt!.getTime() - before).toBeGreaterThanOrEqual(week - 5000);
    expect(saved.returnToRotationAt!.getTime() - before).toBeLessThanOrEqual(week + 60_000);

    await move(lead.id, { status: "IN_PROGRESS" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).returnToRotationAt).toBeNull();

    await move(lead.id, { status: "LOST", returnPeriod: { unit: "months", amount: 3 } });
    saved = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    const days = (saved.returnToRotationAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(88);
    expect(days).toBeLessThan(93);

    const log = await prisma.auditLog.findFirst({
      where: { leadId: lead.id, action: "STATUS_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.metadata).toMatchObject({ to: "LOST", returnPeriod: { unit: "months", amount: 3 } });
  });

  it("recusa período inválido (zero / negativo) com mensagem clara", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const lead = await prisma.lead.create({
      data: { organizationId: org.id, name: "X", status: "IN_PROGRESS", currentBrokerId: brokers[0].id },
    });
    await loginAsBroker(org.id, brokers[0].id);

    for (const amount of [0, -3, 1.5]) {
      const res = await move(lead.id, { status: "LOST", returnPeriod: { unit: "months", amount } });
      expect(res.status).toBe(400);
    }
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("IN_PROGRESS");
  });
});

describe("TESTE 7 (API real) — Preferência de som persiste", () => {
  it("desligar o som salva no banco e continua desligado ao recarregar", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    await loginAsBroker(org.id, brokers[0].id);

    const patch = await mePATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify({ soundEnabled: false }) }));
    expect(patch.status).toBe(200);

    // "Recarregar a página" = nova leitura do servidor.
    const reloaded = (await (await meGET()).json()) as { broker: { soundEnabled: boolean } };
    expect(reloaded.broker.soundEnabled).toBe(false);
  });
});

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { prisma, Role, distributeNewLead, expireAndRotate, returnLeadToRotation } from "@crm/db";
import { createTestOrg, createTestLead, cleanupTestOrg } from "./helpers";
import { notifyNewLead, sendTestPush } from "../src/lib/push-server";
import webpush, { WebPushError } from "web-push";

// Mock auto-contido do "web-push" — não depende da forma exata de interop do pacote real,
// só precisa bater com o que packages/db/src/push-server.ts importa:
// `import webpush, { WebPushError } from "web-push"`. Tudo definido DENTRO da factory
// (inclusive a classe de erro) porque `vi.mock` é hoisted pro topo do arquivo — qualquer
// variável de fora referenciada aqui cairia em "Cannot access before initialization".
vi.mock("web-push", () => {
  class WebPushError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
      this.name = "WebPushError";
    }
  }
  return {
    default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
    WebPushError,
  };
});

const sendNotificationMock = vi.mocked(webpush.sendNotification);
const FAKE_SEND_RESULT = { statusCode: 201, body: "", headers: {} };

// Relógio fixo em horário comercial (15h em Brasília) — notifyNewLead não envia nada no
// horário de silêncio (23h–07h), então sem isso os testes falhariam se rodados à noite.
// setVapidDetails é mock, então qualquer valor serve — só precisa existir pro push não se
// considerar "desativado" (ensureConfigured em packages/db/src/push.ts).
process.env.VAPID_SUBJECT ??= "mailto:teste@example.com";
process.env.VAPID_PUBLIC_KEY ??= "chave-publica-de-teste";
process.env.VAPID_PRIVATE_KEY ??= "chave-privada-de-teste";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T18:00:00Z"));
});

const cleanupIds: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  sendNotificationMock.mockReset();
  while (cleanupIds.length) {
    const id = cleanupIds.pop()!;
    await cleanupTestOrg(id);
  }
});

async function createOwner(organizationId: string, suffix: string) {
  return prisma.user.create({
    data: {
      organizationId,
      name: `Dono ${suffix}`,
      email: `dono_${suffix}@test.local`,
      passwordHash: "x",
      role: Role.OWNER,
    },
  });
}

async function subscribe(organizationId: string, userId: string, endpointSuffix: string) {
  return prisma.pushSubscription.create({
    data: {
      organizationId,
      userId,
      endpoint: `https://push.example.com/${endpointSuffix}`,
      p256dh: "p256dh-key",
      auth: "auth-key",
    },
  });
}

async function brokerUserOf(brokerId: string) {
  const broker = await prisma.broker.findUniqueOrThrow({ where: { id: brokerId } });
  return prisma.user.findUniqueOrThrow({ where: { id: broker.userId } });
}

/** Endpoints e payloads de todos os envios feitos desde o último reset do mock. */
function sentPushes() {
  return sendNotificationMock.mock.calls.map(([subscription, payloadJson]) => ({
    endpoint: subscription.endpoint,
    payload: JSON.parse(String(payloadJson)) as { title: string; body: string; tag: string; url: string },
  }));
}

describe("Web Push — notifyNewLead", () => {
  it("notifica só o dono/admin — corretor não recebe o aviso geral de lead novo", async () => {
    sendNotificationMock.mockResolvedValue(FAKE_SEND_RESULT);

    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const owner = await createOwner(org.id, org.id);
    const brokerUser = await brokerUserOf(brokers[0].id);

    await subscribe(org.id, owner.id, "owner-device");
    await subscribe(org.id, brokerUser.id, "broker-device");

    await notifyNewLead({ id: "lead_1", organizationId: org.id, name: "Carla Souza", source: "meta_ads" });

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const [subscription, payloadJson] = sendNotificationMock.mock.calls[0];
    expect(subscription.endpoint).toBe("https://push.example.com/owner-device");
    const payload = JSON.parse(String(payloadJson));
    expect(payload.url).toBe("/leads/lead_1");
    expect(payload.title).toBe("Novo lead!");
    expect(payload.body).toBe("Carla Souza - via Meta Ads");
  });

  it("não notifica corretor pausado", async () => {
    sendNotificationMock.mockResolvedValue(FAKE_SEND_RESULT);

    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    await prisma.broker.update({ where: { id: brokers[0].id }, data: { status: "PAUSED" } });
    const brokerUser = await prisma.broker
      .findUniqueOrThrow({ where: { id: brokers[0].id } })
      .then((b) => prisma.user.findUniqueOrThrow({ where: { id: b.userId } }));
    await subscribe(org.id, brokerUser.id, "paused-broker-device");

    await notifyNewLead({ id: "lead_2", organizationId: org.id, name: "Lead X", source: "manual" });

    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("não envia nada no horário de silêncio (23h–07h em Brasília)", async () => {
    sendNotificationMock.mockResolvedValue(FAKE_SEND_RESULT);
    vi.setSystemTime(new Date("2026-09-25T03:30:00Z")); // 00h30 em Brasília

    const { org } = await createTestOrg({ brokerCount: 0 });
    cleanupIds.push(org.id);
    const owner = await createOwner(org.id, org.id);
    await subscribe(org.id, owner.id, "night-device");

    await notifyNewLead({ id: "lead_night", organizationId: org.id, name: "Lead Noturno", source: "manual" });

    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("remove a inscrição do banco quando o envio falha com 410 (Gone)", async () => {
    const { org } = await createTestOrg({ brokerCount: 0 });
    cleanupIds.push(org.id);
    const owner = await createOwner(org.id, org.id);
    const sub = await subscribe(org.id, owner.id, "dead-device");

    sendNotificationMock.mockRejectedValue(new WebPushError("Gone", 410, {}, "", ""));

    await notifyNewLead({ id: "lead_3", organizationId: org.id, name: "Lead Y", source: "manual" });

    const stillExists = await prisma.pushSubscription.findUnique({ where: { id: sub.id } });
    expect(stillExists).toBeNull();
  });

  it("registra lastError sem apagar a inscrição em erro que não é 404/410", async () => {
    const { org } = await createTestOrg({ brokerCount: 0 });
    cleanupIds.push(org.id);
    const owner = await createOwner(org.id, org.id);
    const sub = await subscribe(org.id, owner.id, "flaky-device");

    sendNotificationMock.mockRejectedValue(new Error("network timeout"));

    await notifyNewLead({ id: "lead_4", organizationId: org.id, name: "Lead Z", source: "manual" });

    const updated = await prisma.pushSubscription.findUnique({ where: { id: sub.id } });
    expect(updated).not.toBeNull();
    expect(updated?.lastError).toBe("network timeout");
  });

  it("nunca lança mesmo se tudo falhar", async () => {
    const { org } = await createTestOrg({ brokerCount: 0 });
    cleanupIds.push(org.id);
    const owner = await createOwner(org.id, org.id);
    await subscribe(org.id, owner.id, "boom-device");

    sendNotificationMock.mockRejectedValue(new Error("boom"));

    await expect(
      notifyNewLead({ id: "lead_5", organizationId: org.id, name: "Lead W", source: "manual" })
    ).resolves.toBeUndefined();
  });

  it("sendTestPush manda só pro próprio usuário e retorna a contagem", async () => {
    sendNotificationMock.mockResolvedValue(FAKE_SEND_RESULT);

    const { org } = await createTestOrg({ brokerCount: 0 });
    cleanupIds.push(org.id);
    const owner = await createOwner(org.id, org.id);
    await subscribe(org.id, owner.id, "test-device-1");
    await subscribe(org.id, owner.id, "test-device-2");

    const result = await sendTestPush(owner.id);

    expect(result.sent).toBe(2);
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
  });
});

describe("Web Push — aviso de vez na roleta (só para o corretor da vez)", () => {
  /** Org com 3 corretores, todos com aparelho inscrito, e um dono também inscrito. */
  async function setup() {
    sendNotificationMock.mockResolvedValue(FAKE_SEND_RESULT);
    const { org, brokers } = await createTestOrg({ brokerCount: 3, responseTimeoutMinutes: 5 });
    cleanupIds.push(org.id);
    const owner = await createOwner(org.id, org.id);
    await subscribe(org.id, owner.id, `owner-${org.id}`);
    for (const b of brokers) await subscribe(org.id, (await brokerUserOf(b.id)).id, `device-${b.id}`);
    return { org, brokers, ownerId: owner.id };
  }

  async function expire(assignmentId: string) {
    await prisma.leadAssignment.update({ where: { id: assignmentId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const result = await expireAndRotate(assignmentId);
    return result.expired ? result.nextAssignment : null;
  }

  it("a cada passagem da roleta, só o corretor da vez recebe o push — inclusive nas voltas seguintes", async () => {
    const { org, brokers } = await setup();
    const lead = await createTestLead(org.id, "Carla Souza");

    // 1ª vez: corretor #1
    const a1 = await distributeNewLead(org.id, lead.id);
    expect(sentPushes()).toEqual([
      expect.objectContaining({
        endpoint: `https://push.example.com/device-${brokers[0].id}`,
        payload: expect.objectContaining({
          title: "Novo lead na sua vez!",
          body: "O lead Carla Souza está na sua vez na roleta. Você tem 5 min para entrar em contato.",
          tag: `lead-turn-${lead.id}`,
        }),
      }),
    ]);

    // Prazo vence → #2, depois #3: cada um recebe só o seu
    sendNotificationMock.mockClear();
    const a2 = await expire(a1!.id);
    expect(sentPushes().map((p) => p.endpoint)).toEqual([`https://push.example.com/device-${brokers[1].id}`]);

    sendNotificationMock.mockClear();
    const a3 = await expire(a2!.id);
    expect(sentPushes().map((p) => p.endpoint)).toEqual([`https://push.example.com/device-${brokers[2].id}`]);

    // Volta completa → #1 de novo, com a mensagem de "novamente" e a MESMA tag (substitui a antiga)
    sendNotificationMock.mockClear();
    await expire(a3!.id);
    expect(sentPushes()).toEqual([
      expect.objectContaining({
        endpoint: `https://push.example.com/device-${brokers[0].id}`,
        payload: expect.objectContaining({
          title: "Sua vez na roleta novamente",
          body: "O lead Carla Souza está na sua vez na roleta novamente. Você tem 5 min para entrar em contato.",
          tag: `lead-turn-${lead.id}`,
        }),
      }),
    ]);
  });

  it("devolver para a roleta também avisa só o corretor da vez", async () => {
    const { org, brokers, ownerId } = await setup();
    const lead = await createTestLead(org.id);
    const a1 = await distributeNewLead(org.id, lead.id);
    expect(a1!.brokerId).toBe(brokers[0].id);

    sendNotificationMock.mockClear();
    const next = await returnLeadToRotation({ organizationId: org.id, leadId: lead.id, userId: ownerId });

    expect(sentPushes().map((p) => p.endpoint)).toEqual([`https://push.example.com/device-${next!.brokerId}`]);
  });

  it("no horário de silêncio a roleta gira normalmente, mas ninguém é notificado", async () => {
    const { org, brokers } = await setup();
    vi.setSystemTime(new Date("2026-09-25T04:00:00Z")); // 01h em Brasília
    const lead = await createTestLead(org.id);

    const a1 = await distributeNewLead(org.id, lead.id);
    const a2 = await expire(a1!.id);

    expect(a1!.brokerId).toBe(brokers[0].id);
    expect(a2!.brokerId).toBe(brokers[1].id);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});

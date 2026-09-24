import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { prisma, Role } from "@crm/db";
import { createTestOrg, cleanupTestOrg } from "./helpers";
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

describe("Web Push — notifyNewLead", () => {
  it("notifica dono e corretor ativo com URL diferente por role", async () => {
    sendNotificationMock.mockResolvedValue(FAKE_SEND_RESULT);

    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const owner = await createOwner(org.id, org.id);
    const brokerUser = await prisma.broker
      .findUniqueOrThrow({ where: { id: brokers[0].id } })
      .then((b) => prisma.user.findUniqueOrThrow({ where: { id: b.userId } }));

    await subscribe(org.id, owner.id, "owner-device");
    await subscribe(org.id, brokerUser.id, "broker-device");

    await notifyNewLead({ id: "lead_1", organizationId: org.id, name: "Carla Souza", source: "meta_ads" });

    expect(sendNotificationMock).toHaveBeenCalledTimes(2);

    const payloads = sendNotificationMock.mock.calls.map(([, payloadJson]) => JSON.parse(String(payloadJson)));
    const ownerPayload = payloads.find((p: { url: string }) => p.url === "/leads/lead_1");
    const brokerPayload = payloads.find((p: { url: string }) => p.url === "/broker/dashboard");

    expect(ownerPayload).toBeTruthy();
    expect(brokerPayload).toBeTruthy();
    expect(ownerPayload.title).toBe("Novo lead!");
    expect(ownerPayload.body).toBe("Carla Souza - via Meta Ads");
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

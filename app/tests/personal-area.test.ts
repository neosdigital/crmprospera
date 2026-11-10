import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  prisma,
  __setGraphFetchForTests,
  syncBrokerMetaConnection,
  syncAllBrokerMetaConnections,
  sendDuePersonalReminders,
  distributeNewLead,
} from "@crm/db";
import { createTestOrg, cleanupTestOrg } from "./helpers";

// Sessão simulada (mesmo padrão dos outros testes de API).
const sessionRef: { current: unknown } = { current: null };
vi.mock("@/auth", () => ({ auth: vi.fn(async () => sessionRef.current) }));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }) },
  WebPushError: class extends Error {},
}));

import { GET as overviewGET } from "../src/app/api/personal/overview/route";
import { GET as leadsGET } from "../src/app/api/personal/leads/route";
import { GET as leadGET, PATCH as leadPATCH } from "../src/app/api/personal/leads/[id]/route";
import { POST as inspectPOST } from "../src/app/api/personal/connection/inspect/route";
import { POST as connectPOST } from "../src/app/api/personal/connection/route";
import { DELETE as connectionDELETE } from "../src/app/api/personal/connection/[id]/route";
import { GET as adminBrokersGET } from "../src/app/api/personal/admin/brokers/route";
import { PATCH as adminAccessPATCH } from "../src/app/api/personal/admin/brokers/[id]/route";
import { brokerHasPersonalAreaSafe } from "../src/lib/personal-area";

// ------------------------------------------------------------
// Meta falsa (Graph API) — nada sai para a internet
// ------------------------------------------------------------
type FakeLead = { id: string; created_time: string; campaign_name?: string; field_data: { name: string; values: string[] }[] };
const meta = {
  leads: [] as FakeLead[],
  deadTokens: new Set<string>(),
  pageId: "",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeGraph(input: string | URL | Request) {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  const token = url.searchParams.get("access_token") ?? "";
  const path = url.pathname.replace(/^\/v[\d.]+/, "");
  if (meta.deadTokens.has(token)) {
    return json({ error: { message: "Error validating access token: Session has expired", code: 190, error_subcode: 463 } }, 400);
  }
  const pageToken = `page_tok_${meta.pageId}`;
  if (path === "/me" && token === "user_tok_valido") return json({ id: "user_1", name: "João Corretor" });
  if (path === "/me" && token === pageToken) return json({ id: meta.pageId, name: "Página do João" });
  if (path === "/me/accounts" && token === "user_tok_valido") {
    return json({ data: [{ id: meta.pageId, name: "Página do João", access_token: pageToken }] });
  }
  if (path === "/me/accounts") return json({ error: { message: "nonexisting field (accounts)", code: 100 } }, 400);
  if (path === "/me/adaccounts") return json({ data: [{ account_id: "act_99", name: "Conta particular do João" }] });
  if (token !== pageToken) return json({ error: { message: "Invalid OAuth access token", code: 190 } }, 400);
  if (path === `/${meta.pageId}/leadgen_forms`) return json({ data: [{ id: "form_1", name: "Apartamentos em Itajaí", status: "ACTIVE" }] });
  if (path === "/form_1") return json({ id: "form_1", name: "Apartamentos em Itajaí", page: { id: meta.pageId } });
  if (path === "/form_1/leads") return json({ data: meta.leads });
  return json({ error: { message: `rota falsa não mapeada: ${path}`, code: 100 } }, 400);
}

function metaLead(id: string, name: string, minutesAgo = 1): FakeLead {
  return {
    id,
    created_time: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    campaign_name: "Apartamentos em Itajaí",
    field_data: [
      { name: "full_name", values: [name] },
      { name: "phone_number", values: ["+5547999990000"] },
      { name: "email", values: [`${id}@exemplo.com`] },
    ],
  };
}

// ------------------------------------------------------------

const cleanupIds: string[] = [];
let seq = 0;
beforeEach(() => {
  seq += 1;
  meta.leads = [];
  meta.deadTokens = new Set();
  meta.pageId = `page_joao_${Date.now()}_${seq}`;
  __setGraphFetchForTests(fakeGraph as typeof fetch);
});
afterEach(async () => {
  sessionRef.current = null;
  __setGraphFetchForTests(null);
  while (cleanupIds.length) await cleanupTestOrg(cleanupIds.pop()!);
});

async function loginAsBroker(organizationId: string, brokerId: string) {
  const broker = await prisma.broker.findUniqueOrThrow({ where: { id: brokerId } });
  sessionRef.current = { user: { id: broker.userId, role: "BROKER", organizationId, brokerId } };
}
function loginAsOwner(organizationId: string) {
  sessionRef.current = { user: { id: "owner-test", role: "OWNER", organizationId, brokerId: null } };
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function req(method: string, body?: unknown, url = "http://localhost/x") {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
}

async function enable(orgId: string, brokerId: string, enabled = true) {
  loginAsOwner(orgId);
  const res = await adminAccessPATCH(req("PATCH", { enabled }), ctx(brokerId));
  expect(res.status).toBe(200);
}

/** Libera o corretor, conecta a Página dele e devolve o id da conexão. */
async function connect(orgId: string, brokerId: string) {
  await enable(orgId, brokerId);
  await loginAsBroker(orgId, brokerId);
  const res = await connectPOST(req("POST", { token: "user_tok_valido", pageId: meta.pageId, formIds: ["form_1"] }));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { connection: { id: string } };
  return body.connection.id;
}

describe("Área do Corretor — acesso", () => {
  it("corretor sem liberação não acessa as APIs nem vê o item de menu", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    await loginAsBroker(org.id, brokers[0].id);

    expect((await overviewGET(req("GET", undefined, "http://localhost/api/personal/overview"))).status).toBe(403);
    expect((await leadsGET(req("GET", undefined, "http://localhost/api/personal/leads"))).status).toBe(403);
    expect((await inspectPOST(req("POST", { token: "user_tok_valido" }))).status).toBe(403);
    expect(await brokerHasPersonalAreaSafe(brokers[0].id)).toBe(false);
  });

  it("corretor não consegue liberar o próprio acesso; admin libera e o menu aparece", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    await loginAsBroker(org.id, brokers[0].id);
    expect((await adminAccessPATCH(req("PATCH", { enabled: true }), ctx(brokers[0].id))).status).toBe(403);

    await enable(org.id, brokers[0].id);
    expect(await brokerHasPersonalAreaSafe(brokers[0].id)).toBe(true);
  });

  it("admin conecta a conta Meta em nome do corretor e os leads vão só para ele", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 2 });
    cleanupIds.push(org.id);
    const [joao, ana] = brokers;
    const body = { token: "user_tok_valido", pageId: meta.pageId, formIds: ["form_1"] };

    // Sem dizer o corretor: recusado.
    loginAsOwner(org.id);
    expect((await connectPOST(req("POST", body))).status).toBe(422);
    // Corretor sem a Área do Corretor liberada: recusado.
    expect((await connectPOST(req("POST", { ...body, brokerId: joao.id }))).status).toBe(403);

    await enable(org.id, joao.id);
    loginAsOwner(org.id);
    expect((await inspectPOST(req("POST", { token: "user_tok_valido" }))).status).toBe(200);
    const res = await connectPOST(req("POST", { ...body, brokerId: joao.id }));
    expect(res.status).toBe(200);
    const { connection } = (await res.json()) as { connection: { id: string; brokerId: string } };
    expect(connection.brokerId).toBe(joao.id);
    const stored = await prisma.brokerMetaConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(stored.createdByUserId).toBe("owner-test");

    meta.leads = [metaLead("ml_admin", "Maria")];
    await syncBrokerMetaConnection(connection.id);
    const leads = await prisma.personalLead.findMany({ where: { organizationId: org.id } });
    expect(leads.map((l) => l.brokerId)).toEqual([joao.id]);
    expect(ana.id).not.toBe(joao.id);
  });

  it("admin não conecta para corretor de outra imobiliária; corretor não conecta em nome de outro", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 2 });
    cleanupIds.push(org.id);
    const other = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(other.org.id);
    await enable(other.org.id, other.brokers[0].id);
    const body = { token: "user_tok_valido", pageId: meta.pageId, formIds: ["form_1"] };

    loginAsOwner(org.id);
    expect((await connectPOST(req("POST", { ...body, brokerId: other.brokers[0].id }))).status).toBe(404);

    // Corretor mandando o id de outro corretor: a conexão fica com ele mesmo.
    await enable(org.id, brokers[0].id);
    await loginAsBroker(org.id, brokers[0].id);
    const res = await connectPOST(req("POST", { ...body, brokerId: brokers[1].id }));
    expect(res.status).toBe(200);
    const { connection } = (await res.json()) as { connection: { brokerId: string } };
    expect(connection.brokerId).toBe(brokers[0].id);
  });
});

describe("Área do Corretor — conexão com a Meta", () => {
  it("verificar token lista Páginas, formulários e contas sem devolver tokens", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    await enable(org.id, brokers[0].id);
    await loginAsBroker(org.id, brokers[0].id);

    const res = await inspectPOST(req("POST", { token: "user_tok_valido" }));
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("page_tok_");
    const body = JSON.parse(raw);
    expect(body.pages).toEqual([{ id: meta.pageId, name: "Página do João" }]);
    expect(body.forms[0].id).toBe("form_1");
    expect(body.adAccounts[0].id).toBe("act_99");
  });

  it("salva o token criptografado e nunca o expõe", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const connectionId = await connect(org.id, brokers[0].id);
    const stored = await prisma.brokerMetaConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(stored.accessTokenEncrypted).not.toContain("page_tok_");
    expect(stored.brokerId).toBe(brokers[0].id);

    const overview = await overviewGET(req("GET", undefined, "http://localhost/api/personal/overview"));
    expect(await overview.text()).not.toMatch(/page_tok_|accessToken/);
  });

  it("recusa Página que já é da integração geral da imobiliária", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    await prisma.metaIntegration.create({ data: { organizationId: org.id, pageId: meta.pageId, accessTokenEncrypted: "x" } });
    await enable(org.id, brokers[0].id);
    await loginAsBroker(org.id, brokers[0].id);
    const res = await connectPOST(req("POST", { token: "user_tok_valido", pageId: meta.pageId, formIds: ["form_1"] }));
    expect(res.status).toBe(409);
  });

  it("recusa Página já conectada por outro corretor", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 2 });
    cleanupIds.push(org.id);
    await connect(org.id, brokers[0].id);
    await enable(org.id, brokers[1].id);
    await loginAsBroker(org.id, brokers[1].id);
    const res = await connectPOST(req("POST", { token: "user_tok_valido", pageId: meta.pageId, formIds: ["form_1"] }));
    expect(res.status).toBe(409);
  });
});

describe("Área do Corretor — recebimento dos leads", () => {
  it("lead particular entra só na carteira do dono, sem roleta, sem tabela geral e sem duplicar", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 3 });
    cleanupIds.push(org.id);
    const joao = brokers[1]; // corretor #2 da roleta, de propósito
    const connectionId = await connect(org.id, joao.id);

    const rotationBefore = await prisma.rotationState.findUniqueOrThrow({ where: { organizationId: org.id } });
    const auditBefore = await prisma.auditLog.count({ where: { organizationId: org.id } });

    meta.leads = [metaLead("ml_1", "Maria"), metaLead("ml_2", "Pedro")];
    const first = await syncBrokerMetaConnection(connectionId);
    expect(first.created).toBe(2);

    // Reenvio / nova passada: nada duplica.
    meta.leads = [...meta.leads, metaLead("ml_1", "Maria")];
    const again = await syncBrokerMetaConnection(connectionId);
    expect(again.created).toBe(0);
    await syncAllBrokerMetaConnections();

    const personal = await prisma.personalLead.findMany({ where: { organizationId: org.id } });
    expect(personal).toHaveLength(2);
    expect(personal.every((l) => l.brokerId === joao.id && l.sourceType === "BROKER_PERSONAL_META")).toBe(true);
    expect(personal.find((l) => l.metaLeadId === "ml_1")).toMatchObject({
      name: "Maria",
      campaignName: "Apartamentos em Itajaí",
      formId: "form_1",
      pageId: meta.pageId,
      status: "NEW",
    });

    // Operação geral intocada.
    expect(await prisma.lead.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await prisma.leadAssignment.count({ where: { organizationId: org.id } })).toBe(0);
    const rotationAfter = await prisma.rotationState.findUniqueOrThrow({ where: { organizationId: org.id } });
    expect(rotationAfter.currentPosition).toBe(rotationBefore.currentPosition);
    expect(await prisma.auditLog.count({ where: { organizationId: org.id } })).toBe(auditBefore);

    // A roleta continua na mesma ordem: o próximo lead geral vai para o corretor #1.
    const general = await prisma.lead.create({ data: { organizationId: org.id, name: "Lead geral" } });
    const assignment = await distributeNewLead(org.id, general.id);
    expect(assignment?.brokerId).toBe(brokers[0].id);
  });

  it("token expirado marca reconexão e o worker para de consultar até reconectar", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const connectionId = await connect(org.id, brokers[0].id);

    meta.deadTokens.add(`page_tok_${meta.pageId}`);
    const result = await syncBrokerMetaConnection(connectionId);
    expect(result.error).toBeTruthy();
    const conn = await prisma.brokerMetaConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(conn.status).toBe("NEEDS_RECONNECT");

    const all = await syncAllBrokerMetaConnections();
    expect(all.find((r) => r.connectionId === connectionId)).toBeUndefined();
  });

  it("desativar o acesso para o recebimento, preserva o histórico e o admin continua vendo", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const connectionId = await connect(org.id, brokers[0].id);
    meta.leads = [metaLead("ml_old", "Antigo")];
    await syncBrokerMetaConnection(connectionId);

    await enable(org.id, brokers[0].id, false);
    meta.leads = [...meta.leads, metaLead("ml_new", "Novo", 0)];
    const result = await syncBrokerMetaConnection(connectionId);
    expect(result.skipped).toBe("access_disabled");
    expect(await prisma.personalLead.count({ where: { organizationId: org.id } })).toBe(1);

    await loginAsBroker(org.id, brokers[0].id);
    expect((await leadsGET(req("GET", undefined, "http://localhost/api/personal/leads"))).status).toBe(403);

    loginAsOwner(org.id);
    const res = await leadsGET(req("GET", undefined, `http://localhost/api/personal/leads?brokerId=${brokers[0].id}`));
    expect(((await res.json()) as { leads: unknown[] }).leads).toHaveLength(1);
  });

  it("desconectar preserva os leads e para de receber", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const connectionId = await connect(org.id, brokers[0].id);
    meta.leads = [metaLead("ml_a", "A")];
    await syncBrokerMetaConnection(connectionId);

    expect((await connectionDELETE(req("DELETE"), ctx(connectionId))).status).toBe(200);
    meta.leads = [...meta.leads, metaLead("ml_b", "B", 0)];
    expect((await syncBrokerMetaConnection(connectionId)).skipped).toBe("inactive");
    expect(await prisma.personalLead.count({ where: { organizationId: org.id } })).toBe(1);
  });
});

describe("Área do Corretor — isolamento", () => {
  it("corretor não vê lead particular de outro, nem mandando brokerId; admin vê todos; outra empresa não vê nada", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 2 });
    cleanupIds.push(org.id);
    const [joao, ana] = brokers;
    const connectionId = await connect(org.id, joao.id);
    meta.leads = [metaLead("ml_iso", "Maria")];
    await syncBrokerMetaConnection(connectionId);
    const lead = await prisma.personalLead.findFirstOrThrow({ where: { organizationId: org.id } });

    await enable(org.id, ana.id);
    await loginAsBroker(org.id, ana.id);
    const list = await leadsGET(req("GET", undefined, `http://localhost/api/personal/leads?brokerId=${joao.id}`));
    expect(((await list.json()) as { leads: unknown[] }).leads).toHaveLength(0);
    expect((await leadGET(req("GET"), ctx(lead.id))).status).toBe(404);
    expect((await leadPATCH(req("PATCH", { status: "LOST" }), ctx(lead.id))).status).toBe(404);
    expect((await connectionDELETE(req("DELETE"), ctx(connectionId))).status).toBe(404);

    loginAsOwner(org.id);
    const adminList = await leadsGET(req("GET", undefined, "http://localhost/api/personal/leads"));
    expect(((await adminList.json()) as { leads: unknown[] }).leads).toHaveLength(1);
    const adminBrokers = (await (await adminBrokersGET()).json()) as { brokers: { id: string; personalLeads: number }[] };
    expect(adminBrokers.brokers.find((b) => b.id === joao.id)?.personalLeads).toBe(1);

    const other = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(other.org.id);
    loginAsOwner(other.org.id);
    expect((await leadGET(req("GET"), ctx(lead.id))).status).toBe(404);
    const otherList = await leadsGET(req("GET", undefined, "http://localhost/api/personal/leads"));
    expect(((await otherList.json()) as { leads: unknown[] }).leads).toHaveLength(0);
    expect((await leadsGET(req("GET", undefined, `http://localhost/api/personal/leads?brokerId=${joao.id}`))).status).toBe(404);
  });
});

describe("Área do Corretor — carteira particular", () => {
  it("muda etapa, registra histórico e envia o lembrete de remarketing uma única vez", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const connectionId = await connect(org.id, brokers[0].id);
    meta.leads = [metaLead("ml_rmk", "Carla")];
    await syncBrokerMetaConnection(connectionId);
    const lead = await prisma.personalLead.findFirstOrThrow({ where: { organizationId: org.id } });

    await loginAsBroker(org.id, brokers[0].id);
    expect((await leadPATCH(req("PATCH", { status: "CONTACTED" }), ctx(lead.id))).status).toBe(200);
    expect((await leadPATCH(req("PATCH", { status: "EXPIRED" }), ctx(lead.id))).status).toBe(422);
    expect((await leadPATCH(req("PATCH", { status: "REMARKETING" }), ctx(lead.id))).status).toBe(422);
    const res = await leadPATCH(req("PATCH", { status: "REMARKETING", reminderPeriod: { unit: "weeks", amount: 1 } }), ctx(lead.id));
    expect(res.status).toBe(200);

    const saved = await prisma.personalLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(saved.firstContactAt).not.toBeNull();
    expect(saved.remarketingNotifyAt).not.toBeNull();

    // 15h em Brasília (fora do horário de silêncio), 8 dias depois.
    const later = new Date(saved.remarketingNotifyAt!.getTime() + 24 * 60 * 60 * 1000);
    later.setUTCHours(18, 0, 0, 0);
    expect(await sendDuePersonalReminders(50, later)).toBeGreaterThanOrEqual(1);
    expect(await sendDuePersonalReminders(50, later)).toBe(0);

    const events = await prisma.personalLeadEvent.findMany({ where: { personalLeadId: lead.id } });
    expect(events.map((e) => e.type).sort()).toEqual(["RECEIVED", "REMINDER_SENT", "STATUS_CHANGED", "STATUS_CHANGED"]);
  });
});

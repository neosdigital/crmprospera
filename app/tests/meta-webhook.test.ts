import { describe, it, expect, afterEach, vi } from "vitest";
import crypto from "crypto";
import { prisma } from "@crm/db";
import { encryptSecret } from "../src/lib/crypto";
import { createTestOrg, cleanupTestOrg } from "./helpers";

process.env.META_APP_SECRET = "test_app_secret_for_vitest";
process.env.META_VERIFY_TOKEN = "test_verify_token";

function sign(rawBody: string) {
  const sig = crypto.createHmac("sha256", process.env.META_APP_SECRET!).update(rawBody, "utf8").digest("hex");
  return `sha256=${sig}`;
}

const cleanupIds: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  while (cleanupIds.length) {
    const id = cleanupIds.pop()!;
    await cleanupTestOrg(id);
  }
});

describe("Webhook do Meta (/api/webhooks/meta) — seções 12/13/14 do escopo", () => {
  it("GET: verifica o webhook e retorna o hub.challenge quando o token bate", async () => {
    const { GET } = await import("../src/app/api/webhooks/meta/route");
    const req = new Request(
      "http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=test_verify_token&hub.challenge=98765"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("98765");
  });

  it("GET: rejeita quando o verify_token não bate", async () => {
    const { GET } = await import("../src/app/api/webhooks/meta/route");
    const req = new Request(
      "http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=98765"
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("POST: rejeita payload com assinatura inválida", async () => {
    const { POST } = await import("../src/app/api/webhooks/meta/route");
    const body = JSON.stringify({ object: "page", entry: [] });
    const req = new Request("http://localhost/api/webhooks/meta", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=deadbeef" },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("POST: processa um lead novo (busca dados via Graph API mockada), distribui e é idempotente em reenvio duplicado", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 2 });
    cleanupIds.push(org.id);

    const pageId = "page_123";
    await prisma.metaIntegration.create({
      data: {
        organizationId: org.id,
        pageId,
        pageName: "Página de Teste",
        accessTokenEncrypted: encryptSecret("fake_page_token"),
        isActive: true,
      },
    });

    // Mocka as chamadas à Graph API real da Meta com respostas no formato documentado.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/lead_999")) {
        return new Response(
          JSON.stringify({
            id: "lead_999",
            created_time: "2026-01-01T10:00:00+0000",
            ad_id: "ad_1",
            form_id: "form_1",
            field_data: [
              { name: "full_name", values: ["Carla Souza"] },
              { name: "phone_number", values: ["+5547999998888"] },
              { name: "email", values: ["carla@example.com"] },
              { name: "Qual imóvel você procura?", values: ["Apartamento"] },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/ad_1")) {
        return new Response(
          JSON.stringify({ id: "ad_1", name: "Anúncio Teste", campaign: { id: "camp_1", name: "Campanha Teste" }, adset: { id: "adset_1", name: "Conjunto Teste" } }),
          { status: 200 }
        );
      }
      if (url.includes("/form_1")) {
        return new Response(JSON.stringify({ id: "form_1", name: "Formulário Teste" }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../src/app/api/webhooks/meta/route");

    const payload = {
      object: "page",
      entry: [
        {
          id: pageId,
          time: 1700000000,
          changes: [
            {
              field: "leadgen",
              value: {
                leadgen_id: "lead_999",
                page_id: pageId,
                form_id: "form_1",
                adgroup_id: "adset_1",
                ad_id: "ad_1",
                created_time: 1700000000,
              },
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(payload);

    const req1 = new Request("http://localhost/api/webhooks/meta", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(rawBody) },
      body: rawBody,
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);

    const lead = await prisma.lead.findUnique({ where: { metaLeadId: "lead_999" } });
    expect(lead).not.toBeNull();
    expect(lead!.name).toBe("Carla Souza");
    expect(lead!.phone).toBe("+5547999998888");
    expect(lead!.campaignName).toBe("Campanha Teste");
    expect(lead!.adName).toBe("Anúncio Teste");
    expect(lead!.formName).toBe("Formulário Teste");
    expect((lead!.customFields as Record<string, string>)["Qual imóvel você procura?"]).toBe("Apartamento");
    expect(lead!.currentBrokerId).toBe(brokers[0].id); // distribuído automaticamente

    const assignments = await prisma.leadAssignment.findMany({ where: { leadId: lead!.id } });
    expect(assignments).toHaveLength(1);

    // Reenvio do mesmo evento (a Meta reenvia em caso de falha de ack) — não pode duplicar.
    const req2 = new Request("http://localhost/api/webhooks/meta", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(rawBody) },
      body: rawBody,
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);

    const leadsAfterDuplicate = await prisma.lead.findMany({ where: { metaLeadId: "lead_999" } });
    expect(leadsAfterDuplicate).toHaveLength(1);

    const assignmentsAfterDuplicate = await prisma.leadAssignment.findMany({ where: { leadId: lead!.id } });
    expect(assignmentsAfterDuplicate).toHaveLength(1);
  });
});

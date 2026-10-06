import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@crm/db";
import { createTestOrg, cleanupTestOrg } from "./helpers";

const sessionRef: { current: unknown } = { current: null };
vi.mock("@/auth", () => ({ auth: vi.fn(async () => sessionRef.current) }));

import { GET as exportGET } from "../src/app/api/backup/export/route";
import { POST as importPOST } from "../src/app/api/backup/import/route";

const cleanupIds: string[] = [];
afterEach(async () => {
  sessionRef.current = null;
  while (cleanupIds.length) await cleanupTestOrg(cleanupIds.pop()!);
});

function upload(bytes: Uint8Array<ArrayBuffer>, mode: "preview" | "apply", name = "backup.json.gz") {
  const form = new FormData();
  form.append("file", new File([bytes], name));
  form.append("mode", mode);
  return importPOST(new Request("http://test", { method: "POST", body: form }));
}

describe("Configurações → Backup (API real)", () => {
  it("baixa o backup, e ao enviar de volta: prévia não grava, importar devolve só o que falta", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const owner = await prisma.user.findFirstOrThrow({ where: { organizationId: org.id } });
    const lead = await prisma.lead.create({
      data: { organizationId: org.id, name: "Volta pelo backup", status: "IN_PROGRESS", currentBrokerId: brokers[0].id },
    });
    sessionRef.current = { user: { id: owner.id, role: "OWNER", organizationId: org.id, brokerId: null } };

    const res = await exportGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(".json.gz");
    const gz = new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    expect(gz[0]).toBe(0x1f); // gzip

    await prisma.lead.delete({ where: { id: lead.id } });

    const preview = await upload(gz, "preview");
    expect(preview.status).toBe(200);
    const p = await preview.json();
    expect(p.applied).toBe(false);
    expect(p.tables.find((t: { table: string }) => t.table === "leads")).toMatchObject({ inFile: 1, added: 1, skipped: 0 });
    expect(await prisma.lead.findUnique({ where: { id: lead.id } })).toBeNull();

    const applied = await (await upload(gz, "apply")).json();
    expect(applied).toMatchObject({ applied: true, added: p.added });
    expect(await prisma.lead.findUnique({ where: { id: lead.id } })).not.toBeNull();

    const again = await (await upload(gz, "apply")).json();
    expect(again.added).toBe(0);
    expect(await prisma.lead.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("corretor não acessa; arquivo que não é backup é recusado com mensagem clara", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const broker = await prisma.broker.findUniqueOrThrow({ where: { id: brokers[0].id } });

    sessionRef.current = { user: { id: broker.userId, role: "BROKER", organizationId: org.id, brokerId: broker.id } };
    expect((await exportGET()).status).toBe(403);
    expect((await upload(new Uint8Array([1, 2, 3]), "preview")).status).toBe(403);

    sessionRef.current = { user: { id: "owner", role: "OWNER", organizationId: org.id, brokerId: null } };
    const bad = await upload(new TextEncoder().encode(JSON.stringify({ hello: "world" })), "apply", "x.json");
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("não é um backup");
  });
});

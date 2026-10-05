import { describe, it, expect, afterEach, vi } from "vitest";
import webpush from "web-push";
import { prisma, sendRemarketingReminder, findDueRemarketingLeadIds } from "@crm/db";
import { createTestOrg, cleanupTestOrg } from "./helpers";

const sessionRef: { current: unknown } = { current: null };
vi.mock("@/auth", () => ({ auth: vi.fn(async () => sessionRef.current) }));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }) },
  WebPushError: class extends Error {},
}));
process.env.VAPID_SUBJECT ??= "mailto:teste@example.com";
process.env.VAPID_PUBLIC_KEY ??= "chave-publica-de-teste";
process.env.VAPID_PRIVATE_KEY ??= "chave-privada-de-teste";

import { GET as notesGET, POST as notesPOST } from "../src/app/api/leads/[id]/notes/route";
import { PATCH as notePATCH } from "../src/app/api/leads/[id]/notes/[noteId]/route";
import { PATCH as leadPATCH } from "../src/app/api/leads/[id]/route";
import { POST as statusPOST } from "../src/app/api/leads/[id]/status/route";

const cleanupIds: string[] = [];
afterEach(async () => {
  sessionRef.current = null;
  while (cleanupIds.length) await cleanupTestOrg(cleanupIds.pop()!);
});

async function loginAsBroker(organizationId: string, brokerId: string) {
  const broker = await prisma.broker.findUniqueOrThrow({ where: { id: brokerId } });
  sessionRef.current = { user: { id: broker.userId, role: "BROKER", organizationId, brokerId } };
  return broker.userId;
}

const ctx = (id: string, noteId?: string) => ({ params: Promise.resolve(noteId ? { id, noteId } : { id }) }) as never;
const json = (body: unknown, method = "POST") => new Request("http://test", { method, body: JSON.stringify(body) });

type NotesBody = {
  lead: { name: string; phone: string };
  notes: { id: string; kind: string; content: string; legacy: boolean; editedAt: string | null; canEdit: boolean; author: { name: string } | null; revisions: { previousContent: string; newContent: string }[] }[];
};
async function readNotes(leadId: string) {
  const res = await notesGET(new Request("http://test"), ctx(leadId));
  return { status: res.status, body: (await res.json()) as NotesBody };
}

describe("Notas do lead — timeline com histórico de modificações", () => {
  it("anotação antiga aparece como primeira nota; nova nota tem autor e data; edição guarda o texto anterior", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const lead = await prisma.lead.create({
      data: { organizationId: org.id, name: "Caua", phone: "+5547997483493", status: "IN_PROGRESS", currentBrokerId: brokers[0].id, notes: "Anotação antiga do card" },
    });
    // Mesmo formato que a migração gerou para as anotações existentes.
    await prisma.leadNote.create({
      data: { id: `legacy_${lead.id}`, organizationId: org.id, leadId: lead.id, kind: "OBSERVATION", content: "Anotação antiga do card" },
    });
    await loginAsBroker(org.id, brokers[0].id);

    const first = await readNotes(lead.id);
    const { status } = first;
    let { body } = first;
    expect(status).toBe(200);
    expect(body.lead).toMatchObject({ name: "Caua", phone: "+5547997483493" });
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0]).toMatchObject({ kind: "OBSERVATION", content: "Anotação antiga do card", legacy: true });

    expect((await notesPOST(json({ content: "Liguei, vai visitar sábado" }), ctx(lead.id))).status).toBe(201);
    ({ body } = await readNotes(lead.id));
    expect(body.notes).toHaveLength(2);
    const added = body.notes[0]; // mais recente primeiro
    expect(added).toMatchObject({ kind: "NOTE", content: "Liguei, vai visitar sábado", legacy: false, canEdit: true, editedAt: null });
    expect(added.author?.name).toContain("Broker 1");

    expect((await notePATCH(json({ content: "Liguei, visita confirmada sábado 10h" }, "PATCH"), ctx(lead.id, added.id))).status).toBe(200);
    ({ body } = await readNotes(lead.id));
    const edited = body.notes.find((n) => n.id === added.id)!;
    expect(edited.content).toBe("Liguei, visita confirmada sábado 10h");
    expect(edited.editedAt).not.toBeNull();
    expect(edited.revisions).toEqual([
      expect.objectContaining({ previousContent: "Liguei, vai visitar sábado", newContent: "Liguei, visita confirmada sábado 10h" }),
    ]);

    // A anotação antiga continua intacta no campo original.
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).notes).toBe("Anotação antiga do card");
  });

  it("observação do card e timeline ficam sincronizadas, com cada mudança registrada", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const lead = await prisma.lead.create({
      data: { organizationId: org.id, name: "Sync", status: "IN_PROGRESS", currentBrokerId: brokers[0].id },
    });
    await loginAsBroker(org.id, brokers[0].id);

    // Campo do card (rota antiga) cria a observação na timeline...
    await leadPATCH(json({ notes: "Primeira observação" }, "PATCH"), ctx(lead.id));
    // ...e a edição seguinte vira revisão.
    await leadPATCH(json({ notes: "Observação atualizada" }, "PATCH"), ctx(lead.id));
    let { body } = await readNotes(lead.id);
    const obs = body.notes.find((n) => n.kind === "OBSERVATION")!;
    expect(obs.content).toBe("Observação atualizada");
    expect(obs.revisions[0]).toMatchObject({ previousContent: "Primeira observação", newContent: "Observação atualizada" });

    // Editar a observação pela janela atualiza o campo do card.
    await notePATCH(json({ content: "Editada pela janela" }, "PATCH"), ctx(lead.id, obs.id));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).notes).toBe("Editada pela janela");
    ({ body } = await readNotes(lead.id));
    expect(body.notes.find((n) => n.kind === "OBSERVATION")!.revisions).toHaveLength(2);
  });

  it("permissões: corretor de fora não vê; não edita nota de outra pessoa; nota vazia é recusada", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 2 });
    cleanupIds.push(org.id);
    const [a, b] = brokers;
    const lead = await prisma.lead.create({
      data: { organizationId: org.id, name: "Do A", status: "IN_PROGRESS", currentBrokerId: a.id },
    });
    const ownerNote = await prisma.leadNote.create({
      data: { organizationId: org.id, leadId: lead.id, kind: "NOTE", content: "Nota do gestor" },
    });

    await loginAsBroker(org.id, b.id);
    expect((await readNotes(lead.id)).status).toBe(403);
    expect((await notesPOST(json({ content: "invasão" }), ctx(lead.id))).status).toBe(403);

    await loginAsBroker(org.id, a.id);
    expect((await notePATCH(json({ content: "alterei" }, "PATCH"), ctx(lead.id, ownerNote.id))).status).toBe(403);
    expect((await notesPOST(json({ content: "   " }), ctx(lead.id))).status).toBe(400);

    sessionRef.current = { user: { id: "owner-x", role: "OWNER", organizationId: org.id, brokerId: null } };
    expect((await readNotes(lead.id)).status).toBe(200);
  });
});

describe("Remarketing — lembrete agendado para o corretor da carteira", () => {
  it("salva a data, envia o push ao corretor na data, mantém o lead na carteira e não repete", async () => {
    const send = vi.mocked(webpush.sendNotification);
    const { org, brokers } = await createTestOrg({ brokerCount: 2 });
    cleanupIds.push(org.id);
    const [a] = brokers;
    const lead = await prisma.lead.create({
      data: { organizationId: org.id, name: "Remk", status: "IN_PROGRESS", currentBrokerId: a.id },
    });
    const userId = await loginAsBroker(org.id, a.id);
    await prisma.pushSubscription.create({
      data: { organizationId: org.id, userId, endpoint: `https://push.example.com/rmk-${org.id}`, p256dh: "k", auth: "x" },
    });

    expect((await statusPOST(json({ status: "REMARKETING", returnPeriod: { unit: "weeks", amount: 1 } }), ctx(lead.id))).status).toBe(200);
    const saved = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(saved.status).toBe("REMARKETING");
    expect(saved.returnToRotationAt).toBeNull();
    const days = (saved.remarketingNotifyAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    // Antes da data: nada. Na data (simulada): push só para o corretor A.
    send.mockClear();
    expect(await sendRemarketingReminder(lead.id, new Date(saved.remarketingNotifyAt!.getTime() - 60_000))).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(await sendRemarketingReminder(lead.id, new Date(saved.remarketingNotifyAt!.getTime() + 60_000))).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].endpoint).toBe(`https://push.example.com/rmk-${org.id}`);
    expect(JSON.parse(String(send.mock.calls[0][1]))).toMatchObject({ title: "Lembrete de remarketing" });

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ status: "REMARKETING", currentBrokerId: a.id, remarketingNotifyAt: null });
    expect(await prisma.leadAssignment.count({ where: { leadId: lead.id } })).toBe(0); // não foi para a roleta

    // Idempotente.
    expect(await sendRemarketingReminder(lead.id, new Date(saved.remarketingNotifyAt!.getTime() + 120_000))).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sair do Remarketing cancela o lembrete; de madrugada o lembrete espera as 07h", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);
    const lead = await prisma.lead.create({
      data: { organizationId: org.id, name: "Cancela", status: "IN_PROGRESS", currentBrokerId: brokers[0].id },
    });
    await loginAsBroker(org.id, brokers[0].id);

    await statusPOST(json({ status: "REMARKETING", returnPeriod: { unit: "months", amount: 1 } }), ctx(lead.id));
    const notifyAt = (await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).remarketingNotifyAt!;
    const night = new Date(notifyAt.getTime() + 24 * 3600e3);
    night.setUTCHours(4, 0, 0, 0); // 01h em Brasília
    expect(await findDueRemarketingLeadIds(50, org.id, night)).toEqual([]);
    const morning = new Date(night);
    morning.setUTCHours(10, 30, 0, 0); // 07h30 em Brasília
    expect(await findDueRemarketingLeadIds(50, org.id, morning)).toEqual([lead.id]);

    await statusPOST(json({ status: "QUALIFIED" }), ctx(lead.id));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).remarketingNotifyAt).toBeNull();
  });
});

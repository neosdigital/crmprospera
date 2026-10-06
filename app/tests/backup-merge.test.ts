import { describe, it, expect, afterEach } from "vitest";
import { prisma, exportOrganizationBackup, mergeBackupIntoOrganization, validateBackupFile, type BackupFile } from "@crm/db";
import { createTestOrg, cleanupTestOrg } from "./helpers";

const cleanupIds: string[] = [];
afterEach(async () => {
  while (cleanupIds.length) await cleanupTestOrg(cleanupIds.pop()!);
});

/** Org de teste com leads, tentativa na roleta, nota com histórico de edição e auditoria. */
async function seedOrg() {
  const { org, brokers } = await createTestOrg({ brokerCount: 2 });
  cleanupIds.push(org.id);
  const user = await prisma.user.findFirstOrThrow({ where: { organizationId: org.id } });
  const leads = [];
  for (let i = 1; i <= 3; i++) {
    leads.push(
      await prisma.lead.create({
        data: { organizationId: org.id, name: `Lead ${i}`, phone: `+55479999000${i}`, status: "IN_PROGRESS", currentBrokerId: brokers[0].id, notes: `obs ${i}` },
      })
    );
  }
  await prisma.leadAssignment.create({
    data: { organizationId: org.id, leadId: leads[0].id, brokerId: brokers[0].id, attemptNumber: 1, expiresAt: new Date(), status: "CONTACTED" },
  });
  const note = await prisma.leadNote.create({
    data: { organizationId: org.id, leadId: leads[1].id, authorUserId: user.id, kind: "NOTE", content: "versão 2", editedAt: new Date() },
  });
  await prisma.leadNoteRevision.create({ data: { noteId: note.id, previousContent: "versão 1", newContent: "versão 2", editedByUserId: user.id } });
  await prisma.auditLog.create({ data: { organizationId: org.id, leadId: leads[0].id, action: "LEAD_RECEIVED", entityType: "lead" } });
  return { org, brokers, leads, note };
}

async function countOrg(orgId: string) {
  const [leads, assignments, notes, revisions, audits, users, brokers] = await Promise.all([
    prisma.lead.count({ where: { organizationId: orgId } }),
    prisma.leadAssignment.count({ where: { organizationId: orgId } }),
    prisma.leadNote.count({ where: { organizationId: orgId } }),
    prisma.leadNoteRevision.count({ where: { note: { organizationId: orgId } } }),
    prisma.auditLog.count({ where: { organizationId: orgId } }),
    prisma.user.count({ where: { organizationId: orgId } }),
    prisma.broker.count({ where: { organizationId: orgId } }),
  ]);
  return { leads, assignments, notes, revisions, audits, users, brokers };
}

/** Simula o backup diário completo (várias organizações no mesmo arquivo). */
function combine(...files: BackupFile[]): BackupFile {
  const tables: BackupFile["tables"] = {};
  for (const f of files) {
    for (const [t, data] of Object.entries(f.tables)) {
      tables[t] ??= { rowCount: 0, rows: [] };
      tables[t].rows.push(...data.rows);
      tables[t].rowCount += data.rowCount;
    }
  }
  return { ...files[0], scope: "database", organizationId: undefined, tables };
}

// Round-trip pelo JSON, como acontece com o arquivo baixado/enviado.
const viaFile = (b: BackupFile) => JSON.parse(JSON.stringify(b)) as BackupFile;

describe("Backup em Configurações — importar somando, sem duplicar e sem sobrescrever", () => {
  it("exporta só a organização, com todos os registros dela", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const file = await exportOrganizationBackup(prisma, a.org.id);

    expect(validateBackupFile(file)).toBeNull();
    expect(file.tables.organizations.rows.map((r) => r.id)).toEqual([a.org.id]);
    expect(file.tables.leads.rowCount).toBe(3);
    expect(file.tables.lead_notes.rowCount).toBe(1);
    expect(file.tables.lead_note_revisions.rowCount).toBe(1); // sem organization_id: vem pelo vínculo com a nota
    expect(JSON.stringify(file)).not.toContain(b.org.id);
  });

  it("prévia mostra o que falta sem gravar; importar devolve o apagado, mantém o editado e não duplica", async () => {
    const a = await seedOrg();
    const before = await countOrg(a.org.id);
    const file = viaFile(await exportOrganizationBackup(prisma, a.org.id));

    // Depois do backup: um lead (com tentativa/auditoria em cascata) e a nota com histórico somem;
    // outro lead é editado.
    await prisma.lead.delete({ where: { id: a.leads[0].id } });
    await prisma.leadNote.delete({ where: { id: a.note.id } });
    await prisma.lead.update({ where: { id: a.leads[2].id }, data: { name: "Nome editado depois do backup", notes: "obs nova" } });
    const afterDelete = await countOrg(a.org.id);

    const preview = await mergeBackupIntoOrganization(prisma, file, a.org.id, { apply: false });
    expect(preview.applied).toBe(false);
    expect(preview.added).toBeGreaterThan(0);
    expect(await countOrg(a.org.id)).toEqual(afterDelete); // prévia não gravou nada

    const applied = await mergeBackupIntoOrganization(prisma, file, a.org.id, { apply: true });
    expect(applied.added).toBe(preview.added); // prévia = resultado real
    const byTable = Object.fromEntries(applied.tables.map((t) => [t.table, t.added]));
    expect(byTable.leads).toBe(1);
    expect(byTable.lead_notes).toBe(1);
    expect(byTable.lead_note_revisions).toBe(1);

    expect(await countOrg(a.org.id)).toEqual(before); // tudo de volta, nada duplicado
    const edited = await prisma.lead.findUniqueOrThrow({ where: { id: a.leads[2].id } });
    expect(edited).toMatchObject({ name: "Nome editado depois do backup", notes: "obs nova" }); // não sobrescreveu
    const restoredNote = await prisma.leadNote.findUniqueOrThrow({ where: { id: a.note.id }, include: { revisions: true } });
    expect(restoredNote.content).toBe("versão 2");
    expect(restoredNote.revisions[0]).toMatchObject({ previousContent: "versão 1" });

    // Importar de novo não adiciona nada.
    const again = await mergeBackupIntoOrganization(prisma, file, a.org.id, { apply: true });
    expect(again.added).toBe(0);
    expect(await countOrg(a.org.id)).toEqual(before);
  });

  it("backup completo (várias organizações): só entra o da organização de quem importa", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const full = viaFile(combine(await exportOrganizationBackup(prisma, a.org.id), await exportOrganizationBackup(prisma, b.org.id)));

    await prisma.lead.delete({ where: { id: a.leads[1].id } });
    await prisma.lead.delete({ where: { id: b.leads[1].id } });
    const bBefore = await countOrg(b.org.id);

    const result = await mergeBackupIntoOrganization(prisma, full, a.org.id, { apply: true });
    expect(result.tables.find((t) => t.table === "leads")?.added).toBe(1);
    expect(await prisma.lead.findUnique({ where: { id: a.leads[1].id } })).not.toBeNull();
    // A outra organização não foi tocada (o lead apagado dela continua apagado).
    expect(await countOrg(b.org.id)).toEqual(bBefore);
    expect(await prisma.lead.findUnique({ where: { id: b.leads[1].id } })).toBeNull();
  });

  it("recusa registro que aponta para corretor de outra organização", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const file = viaFile(await exportOrganizationBackup(prisma, a.org.id));
    const forged = { ...file.tables.leads.rows[0], id: "forjado_" + a.org.id, meta_lead_id: null, current_broker_id: b.brokers[0].id };
    file.tables.leads.rows.push(forged);

    await mergeBackupIntoOrganization(prisma, file, a.org.id, { apply: true });
    expect(await prisma.lead.findUnique({ where: { id: forged.id as string } })).toBeNull();
  });

  it("arquivo inválido é recusado", () => {
    expect(validateBackupFile({ foo: 1 })).not.toBeNull();
    expect(validateBackupFile({ format: "crm-prospera-backup", formatVersion: 99, tables: {} })).not.toBeNull();
  });
});

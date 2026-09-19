import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@crm/db";
import { distributeNewLead, claimLead, expireAndRotate, ClaimError } from "@crm/db";
import { createTestOrg, createTestLead, cleanupTestOrg } from "./helpers";

const cleanupIds: string[] = [];
afterEach(async () => {
  while (cleanupIds.length) {
    const id = cleanupIds.pop()!;
    await cleanupTestOrg(id);
  }
});

describe("Motor de rotação — cenários críticos (seção 70/71 do escopo)", () => {
  it("1-2-3. novo lead é atribuído ao primeiro corretor da fila e o timer (expiresAt) é gravado pelo servidor", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 3, responseTimeoutMinutes: 5 });
    cleanupIds.push(org.id);
    const lead = await createTestLead(org.id);

    const assignment = await distributeNewLead(org.id, lead.id);

    expect(assignment).not.toBeNull();
    expect(assignment!.brokerId).toBe(brokers[0].id);
    expect(assignment!.attemptNumber).toBe(1);
    expect(assignment!.status).toBe("ASSIGNED");

    const expectedExpiry = assignment!.assignedAt.getTime() + 5 * 60 * 1000;
    expect(Math.abs(assignment!.expiresAt.getTime() - expectedExpiry)).toBeLessThan(2000);

    const updatedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updatedLead.status).toBe("ASSIGNED");
    expect(updatedLead.currentBrokerId).toBe(brokers[0].id);
  });

  it("4-5. corretor assume dentro do prazo → rotação para, lead vira IN_PROGRESS, apenas 1 tentativa existe", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 3 });
    cleanupIds.push(org.id);
    const lead = await createTestLead(org.id);
    const assignment = await distributeNewLead(org.id, lead.id);

    const result = await claimLead({ organizationId: org.id, leadId: lead.id, brokerId: brokers[0].id });
    expect(result.status).toBe("CONTACTED");
    expect(result.id).toBe(assignment!.id);

    const updatedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updatedLead.status).toBe("IN_PROGRESS");
    expect(updatedLead.firstContactAt).not.toBeNull();

    const attempts = await prisma.leadAssignment.findMany({ where: { leadId: lead.id } });
    expect(attempts).toHaveLength(1);
  });

  it("6-7-8. timer expira → lead passa para o próximo corretor, que também pode assumir", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 3 });
    cleanupIds.push(org.id);
    const lead = await createTestLead(org.id);
    const first = await distributeNewLead(org.id, lead.id);
    expect(first!.brokerId).toBe(brokers[0].id);

    // Força o vencimento do prazo (o servidor é a autoridade sobre expiração — seção 4/58)
    await prisma.leadAssignment.update({ where: { id: first!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const expireResult = await expireAndRotate(first!.id);
    expect(expireResult.expired).toBe(true);
    expect(expireResult.nextAssignment?.brokerId).toBe(brokers[1].id);
    expect(expireResult.nextAssignment?.attemptNumber).toBe(2);

    const expiredAttempt = await prisma.leadAssignment.findUniqueOrThrow({ where: { id: first!.id } });
    expect(expiredAttempt.status).toBe("EXPIRED");

    const claimBySecond = await claimLead({ organizationId: org.id, leadId: lead.id, brokerId: brokers[1].id });
    expect(claimBySecond.status).toBe("CONTACTED");
  });

  it("9. ciclo completo: todos expiram e a roleta volta ao primeiro corretor, attempt_number sempre crescente", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 3 });
    cleanupIds.push(org.id);
    const lead = await createTestLead(org.id);

    let current = await distributeNewLead(org.id, lead.id);
    const seenBrokers: string[] = [];
    for (let i = 0; i < 5; i++) {
      seenBrokers.push(current!.brokerId);
      await prisma.leadAssignment.update({ where: { id: current!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const result = await expireAndRotate(current!.id);
      current = result.nextAssignment ?? null;
    }

    // 3 corretores, 5 rotações: 1,2,3,1,2 (índices 0,1,2,0,1)
    expect(seenBrokers).toEqual([brokers[0].id, brokers[1].id, brokers[2].id, brokers[0].id, brokers[1].id]);
    expect(current!.attemptNumber).toBe(6);

    const allAttempts = await prisma.leadAssignment.findMany({ where: { leadId: lead.id }, orderBy: { attemptNumber: "asc" } });
    expect(allAttempts.map((a) => a.attemptNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("10. corretor pausado é pulado pela roleta", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 3 });
    cleanupIds.push(org.id);

    await prisma.broker.update({ where: { id: brokers[1].id }, data: { status: "PAUSED", isInRotation: false } });

    const lead = await createTestLead(org.id);
    const first = await distributeNewLead(org.id, lead.id);
    expect(first!.brokerId).toBe(brokers[0].id);

    await prisma.leadAssignment.update({ where: { id: first!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expireResult = await expireAndRotate(first!.id);

    // broker[1] está pausado — deve pular direto para broker[2]
    expect(expireResult.nextAssignment?.brokerId).toBe(brokers[2].id);
  });

  it("11. dois cliques simultâneos em ENTRAR EM CONTATO: só um vence (sem dupla assunção)", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 2 });
    cleanupIds.push(org.id);
    const lead = await createTestLead(org.id);
    await distributeNewLead(org.id, lead.id);

    const [r1, r2] = await Promise.allSettled([
      claimLead({ organizationId: org.id, leadId: lead.id, brokerId: brokers[0].id }),
      claimLead({ organizationId: org.id, leadId: lead.id, brokerId: brokers[0].id }),
    ]);

    const outcomes = [r1, r2];
    const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
    const rejected = outcomes.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ClaimError);

    const attempts = await prisma.leadAssignment.findMany({ where: { leadId: lead.id, status: "CONTACTED" } });
    expect(attempts).toHaveLength(1);
  });

  it("11b. corretor errado nunca consegue assumir o lead de outro corretor", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 2 });
    cleanupIds.push(org.id);
    const lead = await createTestLead(org.id);
    await distributeNewLead(org.id, lead.id); // vai para brokers[0]

    await expect(
      claimLead({ organizationId: org.id, leadId: lead.id, brokerId: brokers[1].id })
    ).rejects.toMatchObject({ code: "WRONG_BROKER" });
  });

  it("12. meta_lead_id é único — não é possível criar dois leads com o mesmo lead do Meta (idempotência do webhook)", async () => {
    const { org } = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(org.id);

    await prisma.lead.create({ data: { organizationId: org.id, name: "Lead Meta", metaLeadId: "meta_dup_123" } });

    await expect(
      prisma.lead.create({ data: { organizationId: org.id, name: "Lead Meta Duplicado", metaLeadId: "meta_dup_123" } })
    ).rejects.toThrow();
  });

  it("13. isolação cross-tenant: lead de uma organização não aparece para outra", async () => {
    const orgA = await createTestOrg({ brokerCount: 1 });
    const orgB = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(orgA.org.id, orgB.org.id);

    const leadA = await createTestLead(orgA.org.id, "Lead da Org A");

    const { scopedDb } = await import("../src/lib/tenant-db");
    const dbForOrgB = scopedDb(orgB.org.id);
    const found = await dbForOrgB.lead.findUnique({ where: { id: leadA.id } });

    expect(found).toBeNull();
  });

  it("15. organização sem corretor ativo: lead fica WAITING_ASSIGNMENT em vez de travar", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 2 });
    cleanupIds.push(org.id);

    await prisma.broker.updateMany({ where: { organizationId: org.id }, data: { status: "PAUSED", isInRotation: false } });
    void brokers;

    const lead = await createTestLead(org.id);
    const assignment = await distributeNewLead(org.id, lead.id);

    expect(assignment).toBeNull();
    const updatedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updatedLead.status).toBe("WAITING_ASSIGNMENT");
  });

  it("16. leads novos sempre vão para o primeiro do ranking (não é mais round-robin entre leads)", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 3 });
    cleanupIds.push(org.id);
    const leadA = await createTestLead(org.id, "Lead A");
    const leadB = await createTestLead(org.id, "Lead B");
    const leadC = await createTestLead(org.id, "Lead C");

    const a1 = await distributeNewLead(org.id, leadA.id);
    const b1 = await distributeNewLead(org.id, leadB.id);
    const c1 = await distributeNewLead(org.id, leadC.id);

    // Os três são leads DIFERENTES e recém-criados: todos devem cair no corretor #1,
    // mesmo tendo sido distribuídos em sequência.
    expect(a1!.brokerId).toBe(brokers[0].id);
    expect(b1!.brokerId).toBe(brokers[0].id);
    expect(c1!.brokerId).toBe(brokers[0].id);

    // O lead A expira e escala para o #2 — isso não deve afetar para onde um lead NOVO vai.
    await prisma.leadAssignment.update({ where: { id: a1!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expireResult = await expireAndRotate(a1!.id);
    expect(expireResult.nextAssignment?.brokerId).toBe(brokers[1].id);

    const leadD = await createTestLead(org.id, "Lead D");
    const d1 = await distributeNewLead(org.id, leadD.id);
    expect(d1!.brokerId).toBe(brokers[0].id);
  });

  it("Cenário da seção 71: João → Maria → Pedro, Pedro contata, ciclo interrompido em IN_PROGRESS", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 3, responseTimeoutMinutes: 5 });
    cleanupIds.push(org.id);
    const [joao, maria, pedro] = brokers;
    const lead = await createTestLead(org.id, "Carla Souza");

    const a1 = await distributeNewLead(org.id, lead.id);
    expect(a1!.brokerId).toBe(joao.id);

    await prisma.leadAssignment.update({ where: { id: a1!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const e1 = await expireAndRotate(a1!.id);
    expect(e1.nextAssignment?.brokerId).toBe(maria.id);

    await prisma.leadAssignment.update({ where: { id: e1.nextAssignment!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const e2 = await expireAndRotate(e1.nextAssignment!.id);
    expect(e2.nextAssignment?.brokerId).toBe(pedro.id);

    const finalClaim = await claimLead({ organizationId: org.id, leadId: lead.id, brokerId: pedro.id });
    expect(finalClaim.status).toBe("CONTACTED");

    const finalLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(finalLead.status).toBe("IN_PROGRESS");

    const allAttempts = await prisma.leadAssignment.findMany({ where: { leadId: lead.id }, orderBy: { attemptNumber: "asc" } });
    expect(allAttempts.map((a) => ({ broker: a.brokerId, status: a.status }))).toEqual([
      { broker: joao.id, status: "EXPIRED" },
      { broker: maria.id, status: "EXPIRED" },
      { broker: pedro.id, status: "CONTACTED" },
    ]);
  });
});

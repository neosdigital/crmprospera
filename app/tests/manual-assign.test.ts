import { describe, it, expect, afterEach } from "vitest";
import { prisma, distributeNewLead, expireAndRotate, assignLeadManually, returnLeadToRotation, ManualAssignError } from "@crm/db";
import { createTestOrg, createTestLead, cleanupTestOrg } from "./helpers";

const cleanupIds: string[] = [];
afterEach(async () => {
  while (cleanupIds.length) {
    const id = cleanupIds.pop()!;
    await cleanupTestOrg(id);
  }
});

async function anyUserId(organizationId: string) {
  const user = await prisma.user.findFirstOrThrow({ where: { organizationId } });
  return user.id;
}

describe("Direcionamento manual de leads (dono/admin)", () => {
  it("lead novo direcionado vai direto pra carteira do corretor, sem tentativa de roleta", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 3 });
    cleanupIds.push(org.id);
    const lead = await createTestLead(org.id);

    await assignLeadManually({ organizationId: org.id, leadId: lead.id, brokerId: brokers[2].id, userId: await anyUserId(org.id) });

    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.currentBrokerId).toBe(brokers[2].id);
    expect(updated.status).toBe("IN_PROGRESS");
    expect(await prisma.leadAssignment.count({ where: { leadId: lead.id } })).toBe(0);

    // Não mexe no ponteiro da roleta: o próximo lead novo ainda vai pro corretor #1.
    const next = await distributeNewLead(org.id, (await createTestLead(org.id, "Outro")).id);
    expect(next!.brokerId).toBe(brokers[0].id);
  });

  it("transferir lead que está com cronômetro encerra a tentativa ativa e o worker não rotaciona mais", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 3 });
    cleanupIds.push(org.id);
    const lead = await createTestLead(org.id);
    const active = await distributeNewLead(org.id, lead.id);

    await assignLeadManually({ organizationId: org.id, leadId: lead.id, brokerId: brokers[1].id, userId: await anyUserId(org.id) });

    const closed = await prisma.leadAssignment.findUniqueOrThrow({ where: { id: active!.id } });
    expect(closed.status).toBe("TRANSFERRED");

    await prisma.leadAssignment.update({ where: { id: active!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const result = await expireAndRotate(active!.id);
    expect(result.expired).toBe(false);

    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.currentBrokerId).toBe(brokers[1].id);
  });

  it("transferir lead que já está numa etapa do kanban mantém a etapa", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 2 });
    cleanupIds.push(org.id);
    const lead = await prisma.lead.create({
      data: { organizationId: org.id, name: "Agendado", status: "SCHEDULED", currentBrokerId: brokers[0].id },
    });

    await assignLeadManually({ organizationId: org.id, leadId: lead.id, brokerId: brokers[1].id, userId: await anyUserId(org.id) });

    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.status).toBe("SCHEDULED");
    expect(updated.currentBrokerId).toBe(brokers[1].id);
  });

  it("recusa corretor de outra organização", async () => {
    const a = await createTestOrg({ brokerCount: 1 });
    const b = await createTestOrg({ brokerCount: 1 });
    cleanupIds.push(a.org.id, b.org.id);
    const lead = await createTestLead(a.org.id);

    await expect(
      assignLeadManually({ organizationId: a.org.id, leadId: lead.id, brokerId: b.brokers[0].id, userId: await anyUserId(a.org.id) })
    ).rejects.toBeInstanceOf(ManualAssignError);
  });

  it("devolver para a roleta cria uma nova tentativa com cronômetro", async () => {
    const { org, brokers } = await createTestOrg({ brokerCount: 3 });
    cleanupIds.push(org.id);
    const lead = await createTestLead(org.id);
    const userId = await anyUserId(org.id);
    await assignLeadManually({ organizationId: org.id, leadId: lead.id, brokerId: brokers[2].id, userId });

    const assignment = await returnLeadToRotation({ organizationId: org.id, leadId: lead.id, userId });

    expect(assignment).not.toBeNull();
    expect(assignment!.status).toBe("ASSIGNED");
    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.status).toBe("ASSIGNED");
    expect(updated.currentBrokerId).toBe(assignment!.brokerId);
  });
});

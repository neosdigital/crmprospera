import { prisma, Role } from "@crm/db";
import bcrypt from "bcryptjs";

let counter = 0;
function uid() {
  counter += 1;
  return `${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Cria uma organização de teste isolada com N corretores na roleta (posições 1..N).
 * Cada teste usa sua própria organização, então testes podem rodar sem interferir
 * uns nos outros mesmo compartilhando o mesmo banco Postgres.
 */
export async function createTestOrg(opts: { brokerCount?: number; responseTimeoutMinutes?: number } = {}) {
  const { brokerCount = 3, responseTimeoutMinutes = 5 } = opts;
  const suffix = uid();

  const org = await prisma.organization.create({
    data: {
      name: `Test Org ${suffix}`,
      slug: `test-org-${suffix}`,
      responseTimeoutMinutes,
    },
  });

  await prisma.rotationState.create({ data: { organizationId: org.id, currentPosition: 1 } });

  const passwordHash = await bcrypt.hash("test1234", 4);
  const brokers = [];
  for (let i = 0; i < brokerCount; i++) {
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        name: `Broker ${i + 1} ${suffix}`,
        email: `broker${i + 1}_${suffix}@test.local`,
        passwordHash,
        role: Role.BROKER,
      },
    });
    const broker = await prisma.broker.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        displayName: `Broker${i + 1}`,
        rotationPosition: i + 1,
      },
    });
    brokers.push(broker);
  }

  return { org, brokers };
}

export async function createTestLead(organizationId: string, name = "Lead de Teste") {
  return prisma.lead.create({ data: { organizationId, name } });
}

/** Remove a organização de teste e tudo em cascata (leads, assignments, brokers, users, audit logs). */
export async function cleanupTestOrg(organizationId: string) {
  await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
}

import { PrismaClient, Role, LeadStatus, AssignmentStatus, AuditAction } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const BROKERS = [
  { name: "João Silva", email: "joao@imobiliariademo.com.br" },
  { name: "Maria Santos", email: "maria@imobiliariademo.com.br" },
  { name: "Pedro Costa", email: "pedro@imobiliariademo.com.br" },
  { name: "Lucas Almeida", email: "lucas@imobiliariademo.com.br" },
];

const CAMPAIGNS = [
  { campaignId: "cmp_1001", campaignName: "Apartamentos Itajaí", adsetId: "ads_2001", adsetName: "Interesse Apartamento", adId: "ad_3001", adName: "Apartamento 3 dormitórios" },
  { campaignId: "cmp_1002", campaignName: "Casas Centro", adsetId: "ads_2002", adsetName: "Interesse Casa", adId: "ad_3002", adName: "Casa 2 dormitórios com quintal" },
];

const LEAD_NAMES = [
  "Carla Souza", "Marcos Lima", "Ana Paula", "Bruno Ferreira", "Juliana Alves",
  "Rafael Oliveira", "Fernanda Costa", "Diego Martins", "Patricia Rocha", "Gustavo Pereira",
];

function randomPhone() {
  const n = Math.floor(10000000 + Math.random() * 89999999);
  return `5547${n}`;
}

async function main() {
  console.log("Seeding: Imobiliária Demo (ambiente de desenvolvimento)");

  const passwordHash = await bcrypt.hash("demo1234", 10);

  const org = await prisma.organization.upsert({
    where: { slug: "imobiliaria-demo" },
    update: {},
    create: {
      name: "Imobiliária Demo",
      slug: "imobiliaria-demo",
      responseTimeoutMinutes: 5,
    },
  });

  await prisma.rotationState.upsert({
    where: { organizationId: org.id },
    update: { currentPosition: 1 },
    create: { organizationId: org.id, currentPosition: 1 },
  });

  const owner = await prisma.user.upsert({
    where: { email: "dono@imobiliariademo.com.br" },
    update: {},
    create: {
      organizationId: org.id,
      name: "Ricardo Dono",
      email: "dono@imobiliariademo.com.br",
      passwordHash,
      role: Role.OWNER,
    },
  });
  console.log(`OWNER: ${owner.email} / senha: demo1234`);

  const brokers = [];
  for (let i = 0; i < BROKERS.length; i++) {
    const b = BROKERS[i];
    const user = await prisma.user.upsert({
      where: { email: b.email },
      update: {},
      create: {
        organizationId: org.id,
        name: b.name,
        email: b.email,
        passwordHash,
        role: Role.BROKER,
      },
    });

    const broker = await prisma.broker.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        organizationId: org.id,
        userId: user.id,
        displayName: b.name.split(" ")[0],
        phone: `+${randomPhone()}`,
        rotationPosition: i + 1,
        isInRotation: i < 3, // Lucas (index 3) fica pausado por padrão no seed
      },
    });
    brokers.push(broker);
    console.log(`BROKER: ${user.email} / senha: demo1234`);
  }

  await prisma.broker.update({
    where: { id: brokers[3].id },
    data: { status: "PAUSED", pausedReason: "Férias" },
  });

  // Limpa leads de seed anteriores para reexecução idempotente
  await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
  await prisma.leadAssignment.deleteMany({ where: { organizationId: org.id } });
  await prisma.lead.deleteMany({ where: { organizationId: org.id } });

  const now = Date.now();
  for (let i = 0; i < LEAD_NAMES.length; i++) {
    const name = LEAD_NAMES[i];
    const campaign = CAMPAIGNS[i % CAMPAIGNS.length];
    const createdAt = new Date(now - (LEAD_NAMES.length - i) * 45 * 60 * 1000);

    const lead = await prisma.lead.create({
      data: {
        organizationId: org.id,
        name,
        phone: `+${randomPhone()}`,
        email: `${name.toLowerCase().replace(/ /g, ".")}@example.com`,
        source: "meta_ads",
        platform: "facebook",
        ...campaign,
        formId: "form_9001",
        formName: "Formulário de Interesse",
        customFields: {
          "Qual imóvel você procura?": i % 2 === 0 ? "Apartamento" : "Casa",
          "Faixa de investimento": i % 3 === 0 ? "Até R$300.000" : "R$300.000 a R$600.000",
          "Tem interesse em financiamento?": i % 2 === 0 ? "Sim" : "Não",
        },
        status: LeadStatus.NEW,
        createdAt,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        leadId: lead.id,
        action: AuditAction.LEAD_RECEIVED,
        entityType: "lead",
        entityId: lead.id,
        metadata: { source: "seed" },
        createdAt,
      },
    });

    // Simula distribuição simples só para os primeiros leads, deixando os últimos "NEW" sem assignment
    // para exercitar o motor de rotação real quando o usuário testar manualmente.
    if (i < 6) {
      const broker = brokers[i % 3];
      const assignedAt = createdAt;
      const expiresAt = new Date(assignedAt.getTime() + org.responseTimeoutMinutes * 60 * 1000);
      const contacted = i % 2 === 0;

      await prisma.leadAssignment.create({
        data: {
          organizationId: org.id,
          leadId: lead.id,
          brokerId: broker.id,
          attemptNumber: 1,
          assignedAt,
          expiresAt,
          status: contacted ? AssignmentStatus.CONTACTED : AssignmentStatus.EXPIRED,
          respondedAt: contacted ? new Date(assignedAt.getTime() + 90 * 1000) : null,
          responseType: contacted ? "CONTACTED" : null,
        },
      });

      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: contacted ? LeadStatus.IN_PROGRESS : LeadStatus.EXPIRED,
          currentBrokerId: contacted ? broker.id : null,
          firstContactAt: contacted ? new Date(assignedAt.getTime() + 90 * 1000) : null,
        },
      });
    }
  }

  console.log("Seed concluído.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

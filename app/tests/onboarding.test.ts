import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@crm/db";

const cleanupEmails: string[] = [];
afterEach(async () => {
  while (cleanupEmails.length) {
    const email = cleanupEmails.pop()!;
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) await prisma.organization.delete({ where: { id: user.organizationId } }).catch(() => {});
  }
});

describe("Onboarding — criação de uma nova imobiliária (seção 79 do escopo)", () => {
  it("cria organização + rotation_state + usuário OWNER, e bloqueia email duplicado", async () => {
    const { POST } = await import("../src/app/api/onboarding/route");
    const email = `owner_${Date.now()}@test.local`;
    cleanupEmails.push(email);

    const req = new Request("http://localhost/api/onboarding", {
      method: "POST",
      body: JSON.stringify({
        organizationName: "Imobiliária Onboarding Teste",
        ownerName: "Dona Teste",
        email,
        password: "senha12345",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email }, include: { organization: true } });
    expect(user).not.toBeNull();
    expect(user!.role).toBe("OWNER");

    const rotationState = await prisma.rotationState.findUnique({ where: { organizationId: user!.organizationId } });
    expect(rotationState?.currentPosition).toBe(1);

    // Segunda tentativa com o mesmo email deve ser rejeitada
    const req2 = new Request("http://localhost/api/onboarding", {
      method: "POST",
      body: JSON.stringify({
        organizationName: "Outra Imobiliária",
        ownerName: "Outra Pessoa",
        email,
        password: "senha12345",
      }),
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(409);
  });
});

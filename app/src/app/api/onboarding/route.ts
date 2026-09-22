import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma, Role } from "@crm/db";
import { jsonError, ApiError } from "@/lib/errors";

const bodySchema = z.object({
  organizationName: z.string().min(2),
  ownerName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "imobiliaria"
  );
}

/**
 * Cria uma nova imobiliária (organização) + o usuário OWNER inicial. É o único endpoint de
 * criação de organização que não exige autenticação prévia — é assim que uma imobiliária
 * nova entra no CRM pela primeira vez (seção 79: "consigo criar uma imobiliária").
 */
export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());

    const existingUser = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existingUser) throw new ApiError(409, "Já existe uma conta com este email.");

    const baseSlug = slugify(body.organizationName);
    let slug = baseSlug;
    let attempt = 0;
    while (await prisma.organization.findUnique({ where: { slug } })) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: body.organizationName, slug },
      });
      // currentPosition: 0 = "nenhum lead novo distribuído ainda" — o primeiro lead cai no
      // corretor #1 (ver assignNextLead em packages/db/src/rotation.ts).
      await tx.rotationState.create({ data: { organizationId: org.id, currentPosition: 0 } });
      await tx.user.create({
        data: {
          organizationId: org.id,
          name: body.ownerName,
          email: body.email.toLowerCase(),
          passwordHash,
          role: Role.OWNER,
        },
      });
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

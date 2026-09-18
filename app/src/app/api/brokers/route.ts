import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";
import { prisma, Role } from "@crm/db";

export async function GET() {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const db = scopedDb(session.user.organizationId);
    const brokers = await db.broker.findMany({
      orderBy: { rotationPosition: "asc" },
      include: { user: { select: { email: true, name: true } } },
    });
    return NextResponse.json({ brokers });
  } catch (error) {
    return jsonError(error);
  }
}

const createBrokerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
});

function generateTempPassword() {
  return crypto.randomBytes(6).toString("base64url");
}

export async function POST(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const body = createBrokerSchema.parse(await req.json());

    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) throw new ApiError(409, "Já existe um usuário com este email.");

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const result = await prisma.$transaction(async (tx) => {
      const maxPosition = await tx.broker.aggregate({
        where: { organizationId: session.user.organizationId },
        _max: { rotationPosition: true },
      });

      const user = await tx.user.create({
        data: {
          organizationId: session.user.organizationId,
          name: body.name,
          email: body.email.toLowerCase(),
          passwordHash,
          role: Role.BROKER,
        },
      });

      const broker = await tx.broker.create({
        data: {
          organizationId: session.user.organizationId,
          userId: user.id,
          displayName: body.name.split(" ")[0],
          phone: body.phone,
          rotationPosition: (maxPosition._max.rotationPosition ?? 0) + 1,
        },
      });

      return { user, broker };
    });

    return NextResponse.json({ broker: result.broker, tempPassword }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

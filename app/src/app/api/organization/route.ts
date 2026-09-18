import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/api";
import { prisma } from "@crm/db";

export async function GET() {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: session.user.organizationId } });
    return NextResponse.json({ organization: org });
  } catch (error) {
    return jsonError(error);
  }
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  responseTimeoutMinutes: z.coerce.number().int().min(1).max(120).optional(),
});

export async function PATCH(req: Request) {
  try {
    const session = await requireSession(["OWNER"]);
    const body = patchSchema.parse(await req.json());
    const org = await prisma.organization.update({
      where: { id: session.user.organizationId },
      data: body,
    });
    return NextResponse.json({ organization: org });
  } catch (error) {
    return jsonError(error);
  }
}

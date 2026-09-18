import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";

export async function GET() {
  try {
    const session = await requireSession(["BROKER"]);
    if (!session.user.brokerId) throw new ApiError(403, "Usuário não é um corretor.");
    const db = scopedDb(session.user.organizationId);
    const broker = await db.broker.findUnique({
      where: { id: session.user.brokerId },
      include: { user: { select: { name: true, email: true } } },
    });
    return NextResponse.json({ broker });
  } catch (error) {
    return jsonError(error);
  }
}

const patchSchema = z.object({
  phone: z.string().optional(),
  soundEnabled: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  try {
    const session = await requireSession(["BROKER"]);
    if (!session.user.brokerId) throw new ApiError(403, "Usuário não é um corretor.");
    const body = patchSchema.parse(await req.json());
    const db = scopedDb(session.user.organizationId);
    const broker = await db.broker.update({ where: { id: session.user.brokerId }, data: body });
    return NextResponse.json({ broker });
  } catch (error) {
    return jsonError(error);
  }
}

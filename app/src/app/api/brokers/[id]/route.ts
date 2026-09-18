import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";
import { BrokerStatus } from "@crm/db";

const patchSchema = z.object({
  displayName: z.string().min(1).optional(),
  phone: z.string().optional(),
  status: z.nativeEnum(BrokerStatus).optional(),
  isInRotation: z.boolean().optional(),
  pausedReason: z.string().optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const { id } = await params;
    const body = patchSchema.parse(await req.json());
    const db = scopedDb(session.user.organizationId);

    const broker = await db.broker.update({ where: { id }, data: body });
    return NextResponse.json({ broker });
  } catch (error) {
    return jsonError(error);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/api";
import { sendTestMessage } from "@crm/db";

const bodySchema = z.object({ to: z.string().min(8) });

export async function POST(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const { to } = bodySchema.parse(await req.json());

    try {
      await sendTestMessage(session.user.organizationId, to, session.user.name ?? "Corretor");
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 422 });
    }
  } catch (error) {
    return jsonError(error);
  }
}

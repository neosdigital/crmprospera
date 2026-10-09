import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { getNotificationHealth } from "@crm/db";

/** Alerta de saúde das notificações (banner vermelho do painel do dono/admin). */
export async function GET() {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const issues = await getNotificationHealth(session.user.organizationId);
    return NextResponse.json({ issues });
  } catch (error) {
    return jsonError(error);
  }
}

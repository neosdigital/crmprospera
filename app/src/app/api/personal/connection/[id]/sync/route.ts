import { NextResponse } from "next/server";
import { syncBrokerMetaConnection } from "@crm/db";
import { ApiError } from "@/lib/api";
import { requirePersonalViewer, loadConnectionForViewer, personalJsonError } from "@/lib/personal-area";

/** Botão "Sincronizar agora" (o corretor dono ou o dono/admin). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requirePersonalViewer();
    const { id } = await params;
    const connection = await loadConnectionForViewer(viewer, id);
    if (!connection.isActive) throw new ApiError(409, "Esta integração está desconectada.");
    const result = await syncBrokerMetaConnection(connection.id, "manual");
    if (result.skipped === "access_disabled") throw new ApiError(403, "A Área do Corretor está desativada para este corretor.");
    return NextResponse.json(result);
  } catch (error) {
    return personalJsonError(error);
  }
}

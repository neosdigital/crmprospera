import { NextResponse } from "next/server";
import { disconnectBrokerMeta } from "@crm/db";
import { requirePersonalViewer, loadConnectionForViewer, personalJsonError } from "@/lib/personal-area";

/** Desconecta (o próprio corretor ou o dono/admin). Os leads já recebidos são preservados. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requirePersonalViewer();
    const { id } = await params;
    const connection = await loadConnectionForViewer(viewer, id);
    await disconnectBrokerMeta(connection.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return personalJsonError(error);
  }
}

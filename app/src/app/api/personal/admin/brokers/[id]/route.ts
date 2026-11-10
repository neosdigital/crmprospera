import { NextResponse } from "next/server";
import { z } from "zod";
import { setBrokerPersonalAccess } from "@crm/db";
import { requirePersonalAdmin, personalJsonError } from "@/lib/personal-area";

const bodySchema = z.object({ enabled: z.boolean() });

/**
 * Dono/Admin: liga/desliga o acesso de um corretor à Área do Corretor. Desligar não apaga
 * nada — só para de receber leads novos e esconde a seção do corretor.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requirePersonalAdmin();
    const { id } = await params;
    const { enabled } = bodySchema.parse(await req.json());
    const access = await setBrokerPersonalAccess({ organizationId: viewer.organizationId, brokerId: id, enabled, userId: viewer.userId });
    return NextResponse.json({ access: { brokerId: access.brokerId, enabled: access.enabled } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Valor inválido." }, { status: 422 });
    return personalJsonError(error);
  }
}

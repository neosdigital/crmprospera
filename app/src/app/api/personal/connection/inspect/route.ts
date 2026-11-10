import { NextResponse } from "next/server";
import { z } from "zod";
import { inspectBrokerMetaToken } from "@crm/db";
import { requirePersonalViewer, personalJsonError } from "@/lib/personal-area";

const bodySchema = z.object({ token: z.string().min(10), pageId: z.string().optional() });

/**
 * Etapa 1 da conexão: mostra as Páginas (e formulários) que o token enxerga. Não salva nada
 * e nunca devolve tokens. Pode ser usada pelo corretor liberado ou pelo dono/admin.
 */
export async function POST(req: Request) {
  try {
    await requirePersonalViewer();
    const { token, pageId } = bodySchema.parse(await req.json());
    return NextResponse.json(await inspectBrokerMetaToken(token, pageId));
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Cole um token de acesso válido." }, { status: 422 });
    return personalJsonError(error);
  }
}

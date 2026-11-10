import { NextResponse } from "next/server";
import { z } from "zod";
import { connectBrokerMeta, syncBrokerMetaConnection } from "@crm/db";
import { ApiError } from "@/lib/api";
import { requirePersonalViewer, resolveBrokerScope, publicConnection, personalJsonError } from "@/lib/personal-area";

const bodySchema = z.object({
  token: z.string().min(10),
  pageId: z.string().min(1),
  formIds: z.array(z.string().min(1)).min(1).max(50),
  name: z.string().max(120).optional(),
  adAccountId: z.string().max(60).optional().nullable(),
  adAccountName: z.string().max(120).optional().nullable(),
  /** Só considerado para dono/admin (conectar em nome de um corretor). Corretor: ignorado. */
  brokerId: z.string().optional(),
});

/**
 * Etapa 2: salva a conexão da Página particular.
 * - Corretor: a conexão é SEMPRE dele (o brokerId do corpo é ignorado).
 * - Dono/Admin: conecta em nome de um corretor da PRÓPRIA imobiliária, que precisa estar com
 *   a Área do Corretor liberada. Os leads continuam indo só para esse corretor.
 */
export async function POST(req: Request) {
  try {
    const viewer = await requirePersonalViewer();
    const body = bodySchema.parse(await req.json());

    const brokerId = viewer.isAdmin ? await resolveBrokerScope(viewer, body.brokerId ?? null) : viewer.brokerId;
    if (!brokerId) throw new ApiError(422, "Escolha o corretor dono desta conexão.");

    const connection = await connectBrokerMeta({
      organizationId: viewer.organizationId,
      brokerId,
      userId: viewer.userId,
      token: body.token,
      pageId: body.pageId,
      formIds: body.formIds,
      name: body.name,
      adAccountId: body.adAccountId,
      adAccountName: body.adAccountName,
    });

    // Primeira consulta já na hora, para o status aparecer atualizado na tela.
    await syncBrokerMetaConnection(connection.id, "manual").catch(() => undefined);

    return NextResponse.json({ connection: publicConnection(connection) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Preencha o token, a Página e pelo menos um formulário." }, { status: 422 });
    }
    return personalJsonError(error);
  }
}

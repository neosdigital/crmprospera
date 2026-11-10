import { NextResponse } from "next/server";
import { z } from "zod";
import { connectBrokerMeta, syncBrokerMetaConnection } from "@crm/db";
import { requirePersonalBroker, publicConnection, personalJsonError } from "@/lib/personal-area";

const bodySchema = z.object({
  token: z.string().min(10),
  pageId: z.string().min(1),
  formIds: z.array(z.string().min(1)).min(1).max(50),
  name: z.string().max(120).optional(),
  adAccountId: z.string().max(60).optional().nullable(),
  adAccountName: z.string().max(120).optional().nullable(),
});

/**
 * Etapa 2: salva a conexão da Página particular do corretor logado. O dono da conexão é
 * SEMPRE o corretor da sessão — o corpo da requisição não tem (nem aceita) brokerId.
 */
export async function POST(req: Request) {
  try {
    const viewer = await requirePersonalBroker();
    const body = bodySchema.parse(await req.json());

    const connection = await connectBrokerMeta({
      organizationId: viewer.organizationId,
      brokerId: viewer.brokerId,
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

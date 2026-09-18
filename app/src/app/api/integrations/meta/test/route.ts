import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { decryptSecret } from "@/lib/crypto";
import { testPageConnection } from "@/lib/meta";
import { prisma } from "@crm/db";

const bodySchema = z.object({ integrationId: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const { integrationId } = bodySchema.parse(await req.json());

    const integration = await prisma.metaIntegration.findFirst({
      where: { id: integrationId, organizationId: session.user.organizationId },
    });
    if (!integration) throw new ApiError(404, "Integração não encontrada.");

    const accessToken = decryptSecret(integration.accessTokenEncrypted);

    try {
      const page = await testPageConnection(integration.pageId, accessToken);
      return NextResponse.json({ ok: true, pageName: page.name });
    } catch (error) {
      return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 422 });
    }
  } catch (error) {
    return jsonError(error);
  }
}

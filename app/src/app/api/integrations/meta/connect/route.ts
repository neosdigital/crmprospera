import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { testPageConnection, subscribePageToLeadgenWebhook } from "@/lib/meta";
import { prisma, AuditAction, encryptSecret } from "@crm/db";

const bodySchema = z.object({
  pageId: z.string().min(1),
  pageAccessToken: z.string().min(1),
});

/**
 * Conecta uma Página do Meta: valida o token, inscreve a página no webhook "leadgen"
 * e salva o token criptografado. Requer que o usuário já tenha criado o app no Meta for
 * Developers e obtido um token de página de longa duração com as permissões necessárias
 * (ver README) — não é possível automatizar essa parte fora do painel da Meta.
 */
export async function POST(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const { pageId, pageAccessToken } = bodySchema.parse(await req.json());

    let pageName: string;
    try {
      const page = await testPageConnection(pageId, pageAccessToken);
      pageName = page.name;
    } catch (error) {
      throw new ApiError(422, `Não foi possível validar o token/página: ${(error as Error).message}`);
    }

    try {
      await subscribePageToLeadgenWebhook(pageId, pageAccessToken);
    } catch (error) {
      throw new ApiError(422, `Não foi possível inscrever a página no webhook: ${(error as Error).message}`);
    }

    const integration = await prisma.metaIntegration.upsert({
      where: { organizationId_pageId: { organizationId: session.user.organizationId, pageId } },
      create: {
        organizationId: session.user.organizationId,
        pageId,
        pageName,
        accessTokenEncrypted: encryptSecret(pageAccessToken),
        isActive: true,
        webhookVerifiedAt: new Date(),
      },
      update: {
        pageName,
        accessTokenEncrypted: encryptSecret(pageAccessToken),
        isActive: true,
        webhookVerifiedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        action: AuditAction.INTEGRATION_CONNECTED,
        entityType: "meta_integration",
        entityId: integration.id,
        metadata: { pageId, pageName },
      },
    });

    return NextResponse.json({
      integration: { id: integration.id, pageId: integration.pageId, pageName: integration.pageName, isActive: integration.isActive },
    });
  } catch (error) {
    return jsonError(error);
  }
}

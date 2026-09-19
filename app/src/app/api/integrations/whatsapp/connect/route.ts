import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { prisma, AuditAction, encryptSecret, testWhatsAppNumber } from "@crm/db";

const bodySchema = z.object({
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(1),
});

/**
 * Conecta o número de WhatsApp Business (Cloud API): valida o phone_number_id/token
 * e salva o token criptografado. Requer um app Meta com o produto WhatsApp adicionado,
 * um número de telefone verificado e um token com permissão whatsapp_business_messaging
 * (ver /settings/integrations/whatsapp para o passo a passo e os templates a aprovar).
 */
export async function POST(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const { phoneNumberId, accessToken } = bodySchema.parse(await req.json());

    let displayPhoneNumber: string;
    try {
      const info = await testWhatsAppNumber(phoneNumberId, accessToken);
      displayPhoneNumber = info.display_phone_number;
    } catch (error) {
      throw new ApiError(422, `Não foi possível validar o número/token: ${(error as Error).message}`);
    }

    const integration = await prisma.whatsAppIntegration.upsert({
      where: { organizationId: session.user.organizationId },
      create: {
        organizationId: session.user.organizationId,
        phoneNumberId,
        displayPhoneNumber,
        accessTokenEncrypted: encryptSecret(accessToken),
        isActive: true,
      },
      update: {
        phoneNumberId,
        displayPhoneNumber,
        accessTokenEncrypted: encryptSecret(accessToken),
        isActive: true,
        lastError: null,
        lastErrorAt: null,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        action: AuditAction.INTEGRATION_CONNECTED,
        entityType: "whatsapp_integration",
        entityId: integration.id,
        metadata: { phoneNumberId, displayPhoneNumber },
      },
    });

    return NextResponse.json({
      integration: {
        id: integration.id,
        phoneNumberId: integration.phoneNumberId,
        displayPhoneNumber: integration.displayPhoneNumber,
        isActive: integration.isActive,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

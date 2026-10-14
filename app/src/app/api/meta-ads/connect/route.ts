import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { prisma, AuditAction, encryptSecret, inspectAdAccountToken, normalizeAdAccountId } from "@crm/db";

const bodySchema = z.object({
  adAccountId: z.string().min(1),
  accessToken: z.string().min(20),
});

/**
 * Conecta a conta de anúncio acompanhada pela Central Meta Ads. O token deve ser de um
 * usuário do sistema da BM do cliente (Configurações do negócio → Usuários do sistema),
 * com ads_read na conta — nunca o token pessoal de quem administra várias BMs.
 * Valida no Meta antes de salvar e guarda o token criptografado.
 */
export async function POST(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const body = bodySchema.parse(await req.json());
    const adAccountId = normalizeAdAccountId(body.adAccountId);
    if (!adAccountId) throw new ApiError(422, "Informe o ID da conta de anúncio (só números ou act_...).");
    const token = body.accessToken.trim();

    let inspected: Awaited<ReturnType<typeof inspectAdAccountToken>>;
    try {
      inspected = await inspectAdAccountToken(token, adAccountId);
    } catch (error) {
      throw new ApiError(422, `Não foi possível ler a conta com esse token: ${(error as Error).message}`);
    }

    const organizationId = session.user.organizationId;
    const data = {
      adAccountId,
      adAccountName: inspected.name,
      accessTokenEncrypted: encryptSecret(token),
      tokenExpiresAt: inspected.tokenExpiresAt,
      dataAccessExpiresAt: inspected.dataAccessExpiresAt,
      isActive: true,
      alertState: {},
      lastError: null,
    };
    const monitor = await prisma.adAccountMonitor.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });

    await prisma.auditLog.create({
      data: {
        organizationId,
        userId: session.user.id,
        action: AuditAction.INTEGRATION_CONNECTED,
        entityType: "ad_account_monitor",
        entityId: monitor.id,
        metadata: { adAccountId, adAccountName: inspected.name, tokenType: inspected.tokenType },
      },
    });

    return NextResponse.json({ ok: true, adAccountId, adAccountName: inspected.name, tokenType: inspected.tokenType });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE() {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const organizationId = session.user.organizationId;
    const monitor = await prisma.adAccountMonitor.findUnique({ where: { organizationId } });
    if (!monitor) return NextResponse.json({ ok: true });

    await prisma.adAccountMonitor.delete({ where: { organizationId } });
    await prisma.auditLog.create({
      data: {
        organizationId,
        userId: session.user.id,
        action: AuditAction.INTEGRATION_DISCONNECTED,
        entityType: "ad_account_monitor",
        entityId: monitor.id,
        metadata: { adAccountId: monitor.adAccountId },
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

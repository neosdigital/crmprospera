import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { prisma, decryptSecret, fetchAccountSnapshot, META_ADS_PRESETS } from "@crm/db";

/**
 * Central Meta Ads: situação da conta de anúncio da organização (saldo, veiculação, leads).
 * A leitura no Meta é feita aqui no servidor — o token nunca vai para o navegador.
 */
export async function GET(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const monitor = await prisma.adAccountMonitor.findUnique({ where: { organizationId: session.user.organizationId } });
    if (!monitor) return NextResponse.json({ connected: false, presets: META_ADS_PRESETS });

    const requested = new URL(req.url).searchParams.get("preset");
    const preset = META_ADS_PRESETS.some((p) => p.id === requested) ? requested! : "last_7d";
    const info = {
      adAccountId: monitor.adAccountId,
      adAccountName: monitor.adAccountName,
      tokenExpiresAt: monitor.tokenExpiresAt,
      dataAccessExpiresAt: monitor.dataAccessExpiresAt,
      lastCheckAt: monitor.lastCheckAt,
      lastError: monitor.lastError,
    };

    try {
      const snapshot = await fetchAccountSnapshot(decryptSecret(monitor.accessTokenEncrypted), monitor.adAccountId, preset);
      return NextResponse.json({ connected: true, monitor: info, preset, presets: META_ADS_PRESETS, snapshot, fetchedAt: new Date() });
    } catch (error) {
      /* conta conectada, mas o Meta recusou (token sem acesso, conta removida da BM...) */
      return NextResponse.json({ connected: true, monitor: info, preset, presets: META_ADS_PRESETS, snapshot: null, error: (error as Error).message });
    }
  } catch (error) {
    return jsonError(error);
  }
}

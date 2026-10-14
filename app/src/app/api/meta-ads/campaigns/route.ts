import { NextResponse } from "next/server";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { prisma, decryptSecret, fetchCampaigns, META_ADS_PRESETS } from "@crm/db";

/** Campanhas da conta conectada: ativas ou que gastaram no período. */
export async function GET(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const monitor = await prisma.adAccountMonitor.findUnique({ where: { organizationId: session.user.organizationId } });
    if (!monitor) throw new ApiError(404, "Nenhuma conta de anúncio conectada.");

    const requested = new URL(req.url).searchParams.get("preset");
    const preset = META_ADS_PRESETS.some((p) => p.id === requested) ? requested! : "last_7d";
    try {
      return NextResponse.json(await fetchCampaigns(decryptSecret(monitor.accessTokenEncrypted), monitor.adAccountId, preset));
    } catch (error) {
      throw new ApiError(502, `O Meta não respondeu: ${(error as Error).message}`);
    }
  } catch (error) {
    return jsonError(error);
  }
}

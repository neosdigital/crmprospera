import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";

export async function GET() {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const db = scopedDb(session.user.organizationId);
    const integrations = await db.metaIntegration.findMany({ orderBy: { createdAt: "desc" } });

    return NextResponse.json({
      integrations: integrations.map((i) => ({
        id: i.id,
        pageId: i.pageId,
        pageName: i.pageName,
        isActive: i.isActive,
        lastEventAt: i.lastEventAt,
        lastLeadSyncAt: i.lastLeadSyncAt,
        webhookVerifiedAt: i.webhookVerifiedAt,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

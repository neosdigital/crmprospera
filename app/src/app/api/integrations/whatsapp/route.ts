import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";
import { WHATSAPP_TEMPLATES } from "@crm/db";

export async function GET() {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const db = scopedDb(session.user.organizationId);
    const integration = await db.whatsAppIntegration.findUnique({
      where: { organizationId: session.user.organizationId },
    });

    return NextResponse.json({
      integration: integration
        ? {
            id: integration.id,
            phoneNumberId: integration.phoneNumberId,
            displayPhoneNumber: integration.displayPhoneNumber,
            isActive: integration.isActive,
            lastMessageAt: integration.lastMessageAt,
            lastErrorAt: integration.lastErrorAt,
            lastError: integration.lastError,
          }
        : null,
      templates: WHATSAPP_TEMPLATES,
    });
  } catch (error) {
    return jsonError(error);
  }
}

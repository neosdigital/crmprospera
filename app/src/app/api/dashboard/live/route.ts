import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";
import { sweepOrganizationExpirations } from "@crm/db";
import { applyLeadContactPrivacy } from "@/lib/lead-privacy";

export async function GET() {
  try {
    // Corretores também acompanham a aba "Ao Vivo" (somente leitura).
    const session = await requireSession(["OWNER", "ADMIN", "BROKER"]);

    await sweepOrganizationExpirations(session.user.organizationId);

    const db = scopedDb(session.user.organizationId);

    const activeLeads = await db.lead.findMany({
      where: { status: { in: ["ASSIGNED", "CONTACTED", "IN_PROGRESS"] } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        currentBroker: { select: { id: true, displayName: true } },
        assignments: {
          orderBy: { attemptNumber: "asc" },
          include: { broker: { select: { displayName: true } } },
        },
      },
    });

    const recentlyExpired = await db.lead.findMany({
      where: { status: "EXPIRED", updatedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });

    const viewer = { role: session.user.role, brokerId: session.user.brokerId };

    return NextResponse.json({
      activeLeads: activeLeads.map((lead) => {
        const currentAssignment =
          lead.assignments.find((a) => a.status === "ASSIGNED") ?? lead.assignments[lead.assignments.length - 1];
        // Corretor só recebe telefone/e-mail completos dos leads que estão com ele (ver lead-privacy.ts).
        const contact = applyLeadContactPrivacy(viewer, {
          currentBrokerId: lead.currentBrokerId,
          phone: lead.phone,
          email: lead.email,
          customFields: lead.customFields,
        });

        return {
          id: lead.id,
          name: lead.name,
          phone: contact.phone,
          email: contact.email,
          contactProtected: contact.contactProtected,
          protectedFieldKeys: contact.protectedFieldKeys,
          campaignName: lead.campaignName,
          customFields: contact.customFields,
          status: lead.status,
          brokerName: lead.currentBroker?.displayName ?? null,
          assignedAt: currentAssignment?.assignedAt ?? null,
          expiresAt: currentAssignment?.status === "ASSIGNED" ? currentAssignment.expiresAt : null,
          brokersPassedCount: lead.assignments.length,
          brokersPassedNames: lead.assignments.map((a) => a.broker.displayName),
        };
      }),
      recentlyExpired: recentlyExpired.map((lead) => ({ id: lead.id, name: lead.name })),
      serverNow: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

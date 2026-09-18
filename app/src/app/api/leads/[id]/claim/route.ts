import { NextResponse } from "next/server";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { claimLead, ClaimError } from "@crm/db";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(["BROKER"]);
    const { id } = await params;

    if (!session.user.brokerId) {
      throw new ApiError(403, "Apenas corretores podem assumir leads.");
    }

    const assignment = await claimLead({
      organizationId: session.user.organizationId,
      leadId: id,
      brokerId: session.user.brokerId,
    });

    return NextResponse.json({ assignment });
  } catch (error) {
    if (error instanceof ClaimError) {
      const statusByCode = { NOT_FOUND: 404, ALREADY_HANDLED: 409, EXPIRED: 409, WRONG_BROKER: 409 } as const;
      return NextResponse.json({ error: error.message, code: error.code }, { status: statusByCode[error.code] });
    }
    return jsonError(error);
  }
}

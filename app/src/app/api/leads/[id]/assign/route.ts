import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/api";
import { assignLeadManually, returnLeadToRotation, ManualAssignError } from "@crm/db";
import { notifyLeadAssignedToBroker } from "@/lib/push-server";
import { runAfterResponse } from "@/lib/run-after-response";

const bodySchema = z.object({
  /** null = devolver para a roleta; id = direcionar direto pra carteira desse corretor. */
  brokerId: z.string().min(1).nullable(),
});

/** Transferência manual de um lead existente — exclusiva de dono/admin. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const { id } = await params;
    const { brokerId } = bodySchema.parse(await req.json());
    const organizationId = session.user.organizationId;

    if (brokerId === null) {
      const assignment = await returnLeadToRotation({ organizationId, leadId: id, userId: session.user.id });
      return NextResponse.json({
        assignment,
        warning: assignment ? undefined : "Não há corretores ativos na roleta — o lead ficou aguardando atribuição.",
      });
    }

    const { lead } = await assignLeadManually({ organizationId, leadId: id, brokerId, userId: session.user.id });
    runAfterResponse(() => notifyLeadAssignedToBroker({ id: lead.id, name: lead.name }, brokerId));
    return NextResponse.json({ lead });
  } catch (error) {
    if (error instanceof ManualAssignError) {
      const statusByCode = { NOT_FOUND: 404, BROKER_NOT_FOUND: 404, BROKER_INACTIVE: 409 } as const;
      return NextResponse.json({ error: error.message, code: error.code }, { status: statusByCode[error.code] });
    }
    return jsonError(error);
  }
}

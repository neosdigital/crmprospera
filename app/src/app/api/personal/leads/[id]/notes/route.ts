import { NextResponse } from "next/server";
import { z } from "zod";
import { addPersonalLeadNote } from "@crm/db";
import { requirePersonalViewer, loadPersonalLeadForViewer, personalJsonError } from "@/lib/personal-area";

const bodySchema = z.object({ content: z.string() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requirePersonalViewer();
    const { id } = await params;
    const lead = await loadPersonalLeadForViewer(viewer, id);
    const { content } = bodySchema.parse(await req.json());
    const note = await addPersonalLeadNote({ organizationId: viewer.organizationId, leadId: lead.id, userId: viewer.userId, content });
    return NextResponse.json({ note: { id: note.id, content: note.content, createdAt: note.createdAt } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Nota inválida." }, { status: 422 });
    return personalJsonError(error);
  }
}

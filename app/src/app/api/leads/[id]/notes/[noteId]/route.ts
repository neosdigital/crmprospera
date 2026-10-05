import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { editLeadNote, loadLeadForNotes, parseNoteContent } from "@/lib/lead-notes";

/** Edita uma nota da timeline — a versão anterior fica registrada no histórico de edições. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    const session = await requireSession();
    const { id, noteId } = await params;
    const content = parseNoteContent(await req.json());
    const viewer = { id: session.user.id, role: session.user.role, brokerId: session.user.brokerId };
    const lead = await loadLeadForNotes(session.user.organizationId, id, viewer);

    const note = await editLeadNote({ organizationId: session.user.organizationId, leadId: lead.id, noteId, viewer, content });
    return NextResponse.json({ note });
  } catch (error) {
    return jsonError(error);
  }
}

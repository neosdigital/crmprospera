import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { prisma } from "@crm/db";
import { addLeadNote, loadLeadForNotes, parseNoteContent } from "@/lib/lead-notes";

/**
 * Janela "Ver Notas": informações do lead + timeline completa de notas (com o histórico de
 * edições de cada uma). Corretor só acessa leads da própria carteira (ver lead-notes.ts).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const viewer = { id: session.user.id, role: session.user.role, brokerId: session.user.brokerId };
    const lead = await loadLeadForNotes(session.user.organizationId, id, viewer);

    const notes = await prisma.leadNote.findMany({
      where: { leadId: lead.id },
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: { id: true, name: true, role: true } },
        revisions: {
          orderBy: { editedAt: "desc" },
          include: { editedBy: { select: { name: true } } },
        },
      },
    });

    return NextResponse.json({
      lead: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        campaignName: lead.campaignName,
        adName: lead.adName,
        formName: lead.formName,
        source: lead.source,
        status: lead.status,
        brokerName: lead.currentBroker?.displayName ?? null,
        createdAt: lead.createdAt,
        customFields: lead.customFields,
      },
      notes: notes.map((n) => ({
        id: n.id,
        kind: n.kind,
        content: n.content,
        createdAt: n.createdAt,
        editedAt: n.editedAt,
        // Nota copiada do sistema antigo na migração: data aproximada, autor desconhecido.
        legacy: n.id.startsWith("legacy_"),
        author: n.author ? { name: n.author.name, role: n.author.role } : null,
        canEdit: n.kind === "OBSERVATION" || n.authorUserId === viewer.id || viewer.role !== "BROKER",
        revisions: n.revisions.map((r) => ({
          id: r.id,
          previousContent: r.previousContent,
          newContent: r.newContent,
          editedAt: r.editedAt,
          editedBy: r.editedBy?.name ?? null,
        })),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}


export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const content = parseNoteContent(await req.json());
    const viewer = { id: session.user.id, role: session.user.role, brokerId: session.user.brokerId };
    const lead = await loadLeadForNotes(session.user.organizationId, id, viewer);

    const note = await addLeadNote({ organizationId: session.user.organizationId, leadId: lead.id, userId: session.user.id, content });
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

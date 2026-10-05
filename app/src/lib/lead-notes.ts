import { prisma } from "@crm/db";
import type { Prisma, Role } from "@crm/db";
import { ApiError } from "@/lib/errors";

/**
 * Timeline de notas do lead (tabela lead_notes + lead_note_revisions).
 *
 * - Quem vê/escreve: dono/admin em qualquer lead da organização; corretor só nos leads que
 *   estão com ele (lead.currentBrokerId) — a mesma regra de quem pode editar o lead hoje.
 * - Editar: o autor da nota ou dono/admin. A "Observação" do card (kind OBSERVATION) é um
 *   campo compartilhado do lead, então quem tem acesso ao lead pode editá-la.
 * - Toda modificação grava uma revisão (antes → depois, quem, quando). Nada é apagado.
 * - A observação continua espelhada em leads.notes (campo original, usado pelo card, pela
 *   coluna "Observação" de /leads e pelo CSV) — as duas ficam sempre iguais.
 */

export type NotesViewer = { id: string; role: Role; brokerId: string | null };

export const NOTE_MAX_LENGTH = 5000;

export function canAccessLeadNotes(viewer: NotesViewer, lead: { currentBrokerId: string | null }) {
  if (viewer.role !== "BROKER") return true;
  return Boolean(viewer.brokerId) && lead.currentBrokerId === viewer.brokerId;
}

export async function loadLeadForNotes(organizationId: string, leadId: string, viewer: NotesViewer) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    include: { currentBroker: { select: { displayName: true } } },
  });
  if (!lead) throw new ApiError(404, "Lead não encontrado.");
  if (!canAccessLeadNotes(viewer, lead)) {
    throw new ApiError(403, "Você só pode ver as notas dos leads da sua carteira.");
  }
  return lead;
}

type Tx = Prisma.TransactionClient;

/**
 * Grava a nova versão da observação do card na timeline: cria a nota OBSERVATION se ainda
 * não existe, ou registra uma revisão (antes → depois) se o texto mudou. Deve rodar na mesma
 * transação que atualiza leads.notes.
 */
export async function recordObservationChange(
  tx: Tx,
  params: { organizationId: string; leadId: string; userId: string; previous: string | null; next: string }
) {
  const previous = params.previous ?? "";
  if (previous === params.next) return;

  const existing = await tx.leadNote.findFirst({
    where: { leadId: params.leadId, kind: "OBSERVATION" },
    orderBy: { createdAt: "asc" },
  });

  if (!existing) {
    if (params.next.trim() === "") return;
    await tx.leadNote.create({
      data: {
        organizationId: params.organizationId,
        leadId: params.leadId,
        authorUserId: params.userId,
        kind: "OBSERVATION",
        content: params.next,
      },
    });
    return;
  }

  const now = new Date();
  await tx.leadNoteRevision.create({
    data: {
      noteId: existing.id,
      previousContent: existing.content,
      newContent: params.next,
      editedByUserId: params.userId,
      editedAt: now,
    },
  });
  await tx.leadNote.update({ where: { id: existing.id }, data: { content: params.next, editedAt: now } });
}

/** Valida o texto de uma nota (vazio / longo demais) com mensagem clara (400). */
export function parseNoteContent(body: unknown): string {
  const raw = (body as { content?: unknown } | null)?.content;
  const content = typeof raw === "string" ? raw.trim() : "";
  if (!content) throw new ApiError(400, "Escreva a nota antes de salvar.");
  if (content.length > NOTE_MAX_LENGTH) throw new ApiError(400, `A nota pode ter no máximo ${NOTE_MAX_LENGTH} caracteres.`);
  return content;
}

export async function addLeadNote(params: { organizationId: string; leadId: string; userId: string; content: string }) {
  return prisma.leadNote.create({
    data: {
      organizationId: params.organizationId,
      leadId: params.leadId,
      authorUserId: params.userId,
      kind: "NOTE",
      content: params.content,
    },
  });
}

export async function editLeadNote(params: {
  organizationId: string;
  leadId: string;
  noteId: string;
  viewer: NotesViewer;
  content: string;
}) {
  return prisma.$transaction(async (tx) => {
    const note = await tx.leadNote.findFirst({
      where: { id: params.noteId, leadId: params.leadId, organizationId: params.organizationId },
    });
    if (!note) throw new ApiError(404, "Nota não encontrada.");

    const isAuthor = note.authorUserId === params.viewer.id;
    const isManager = params.viewer.role !== "BROKER";
    if (note.kind !== "OBSERVATION" && !isAuthor && !isManager) {
      throw new ApiError(403, "Só quem escreveu a nota (ou um gestor) pode editá-la.");
    }
    if (note.content === params.content) return note;

    const now = new Date();
    await tx.leadNoteRevision.create({
      data: {
        noteId: note.id,
        previousContent: note.content,
        newContent: params.content,
        editedByUserId: params.viewer.id,
        editedAt: now,
      },
    });
    const updated = await tx.leadNote.update({
      where: { id: note.id },
      data: { content: params.content, editedAt: now },
    });
    // A observação do card continua espelhada no campo original do lead.
    if (note.kind === "OBSERVATION") {
      await tx.lead.update({ where: { id: params.leadId }, data: { notes: params.content } });
    }
    return updated;
  });
}

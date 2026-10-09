"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import { X, Pencil, History, Send, StickyNote, ChevronDown } from "lucide-react";
import { ProtectedContact } from "@/components/leads/protected-contact";
import { fetcher, poster, patcher, FetchError } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatBrasilia } from "@/lib/brasilia-time";
import { formatMetaFieldText } from "@/lib/format-text";
import { leadStatusLabel } from "@/lib/labels";

type Revision = { id: string; previousContent: string; newContent: string; editedAt: string; editedBy: string | null };

type Note = {
  id: string;
  kind: "NOTE" | "OBSERVATION" | string;
  content: string;
  createdAt: string;
  editedAt: string | null;
  legacy: boolean;
  author: { name: string; role: string } | null;
  canEdit: boolean;
  revisions: Revision[];
};

type NotesResponse = {
  lead: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    campaignName: string | null;
    adName: string | null;
    formName: string | null;
    source: string;
    status: string;
    brokerName: string | null;
    createdAt: string;
    customFields: Record<string, unknown>;
    /** Corretor sem o lead na carteira: contato já vem mascarado do servidor. */
    contactProtected?: boolean;
    protectedFieldKeys?: string[];
  };
  notes: Note[];
};

/** "05/10/2026 às 14:32" no horário de Brasília. */
const when = (iso: string) => `${formatBrasilia(iso, "dd/MM/yyyy")} às ${formatBrasilia(iso, "HH:mm")}`;

function InfoRow({
  label,
  value,
  isProtected = false,
}: {
  label: string;
  value: string | null | undefined;
  /** Contato de lead fora da carteira do corretor: exibe com cadeado + desfoque. */
  isProtected?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="break-words text-sm text-foreground">
        <ProtectedContact value={value} isProtected={isProtected} />
      </p>
    </div>
  );
}

/**
 * "Informações do Lead": só o nome fica em evidência; o resto (contato, status, campanha,
 * respostas do formulário...) aparece ao tocar na setinha. Começa recolhido.
 */
function LeadInfo({ lead }: { lead: NotesResponse["lead"] }) {
  const [expanded, setExpanded] = useState(false);
  const protectedContact = Boolean(lead.contactProtected);
  const customFields = Object.entries(lead.customFields ?? {});

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Informações do Lead</h2>
      <div className="mt-3 rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="lead-info-details"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="min-w-0 truncate text-lg font-semibold text-foreground">{lead.name}</span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-text-secondary">
            {expanded ? "Ocultar" : "Mais informações"}
            <ChevronDown size={18} className={["text-gold transition-transform", expanded ? "rotate-180" : ""].join(" ")} />
          </span>
        </button>

        {expanded && (
          <div
            id="lead-info-details"
            className="grid grid-cols-1 gap-3 border-t border-[color:var(--color-border-gold)] px-4 py-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <InfoRow label="Telefone" value={lead.phone} isProtected={protectedContact} />
            <InfoRow label="E-mail" value={lead.email} isProtected={protectedContact} />
            <InfoRow label="Status" value={leadStatusLabel(lead.status)} />
            <InfoRow label="Corretor" value={lead.brokerName} />
            <InfoRow label="Recebido em" value={when(lead.createdAt)} />
            <InfoRow label="Campanha" value={lead.campaignName} />
            <InfoRow label="Anúncio" value={lead.adName} />
            <InfoRow label="Formulário" value={lead.formName} />
            {customFields.map(([q, a]) => {
              const isContact = lead.protectedFieldKeys?.includes(q) ?? false;
              return (
                <InfoRow
                  key={q}
                  label={formatMetaFieldText(q)}
                  value={isContact ? String(a) : formatMetaFieldText(String(a))}
                  isProtected={isContact}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function NoteItem({ note, leadId, onChanged }: { note: Note; leadId: string; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await patcher(`/api/leads/${leadId}/notes/${note.id}`, { content: draft });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : "Não foi possível salvar a edição.");
    } finally {
      setSaving(false);
    }
  }

  const authorLabel = note.author?.name ?? (note.legacy ? "Anotação anterior ao histórico" : "Usuário removido");

  return (
    <li className="relative pl-6">
      <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-gold" aria-hidden />
      <div className="rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 p-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-foreground">{authorLabel}</p>
          {note.kind === "OBSERVATION" && (
            <span className="rounded bg-gold-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gold">
              Observação do card
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-text-secondary">
          {note.legacy ? `Registrada até ${when(note.createdAt)} (data aproximada)` : `Postada em ${when(note.createdAt)}`}
          {note.editedAt && ` · Editada em ${when(note.editedAt)}`}
        </p>

        {editing ? (
          <div className="mt-2">
            <Textarea rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} className="text-sm" autoFocus />
            {error && <p className="mt-1 text-xs text-danger">{error}</p>}
            <div className="mt-2 flex gap-2">
              <Button className="py-1.5 text-xs" disabled={saving || !draft.trim() || draft === note.content} onClick={save}>
                {saving ? "Salvando..." : "Salvar edição"}
              </Button>
              <Button
                variant="ghost"
                className="py-1.5 text-xs"
                onClick={() => {
                  setEditing(false);
                  setDraft(note.content);
                  setError(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{note.content}</p>
        )}

        {!editing && (note.canEdit || note.revisions.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            {note.canEdit && (
              <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1 text-gold hover:underline">
                <Pencil size={12} /> Editar
              </button>
            )}
            {note.revisions.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="flex items-center gap-1 text-text-secondary hover:text-foreground"
              >
                <History size={12} />
                {showHistory ? "Ocultar modificações" : `Ver modificações (${note.revisions.length})`}
              </button>
            )}
          </div>
        )}

        {showHistory && (
          <ol className="mt-2 space-y-2 border-t border-[color:var(--color-border-gold)]/40 pt-2">
            {note.revisions.map((r) => (
              <li key={r.id} className="text-xs">
                <p className="text-text-secondary">
                  {when(r.editedAt)}
                  {r.editedBy ? ` — ${r.editedBy}` : ""} alterou de:
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words rounded-lg bg-surface px-2 py-1.5 text-text-secondary line-through decoration-text-secondary/40">
                  {r.previousContent || "(vazio)"}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

/**
 * Janela (quase tela cheia) de acompanhamento das notas do lead: "Informações do Lead" em
 * cima e, abaixo, a timeline de evolução — cada nota com data/hora de quando foi postada e,
 * se modificada, quando e por quem (com o texto anterior). As anotações antigas do card
 * aparecem como primeira nota ("Observação do card").
 */
export function LeadNotesDialog({ leadId, onClose, onChanged }: { leadId: string; onClose: () => void; onChanged?: () => void }) {
  const { data, error, isLoading, mutate } = useSWR<NotesResponse>(`/api/leads/${leadId}/notes`, fetcher);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function refresh() {
    mutate();
    onChanged?.();
  }

  async function addNote() {
    setSaving(true);
    setSaveError(null);
    try {
      await poster(`/api/leads/${leadId}/notes`, { content: draft });
      setDraft("");
      refresh();
    } catch (err) {
      setSaveError(err instanceof FetchError ? err.message : "Não foi possível salvar a nota.");
    } finally {
      setSaving(false);
    }
  }

  const lead = data?.lead;

  // Portal no <body>: a janela não fica dentro do card arrastável do kanban (selecionar texto
  // aqui não pode iniciar o arrastar do card).
  return createPortal(
    <div className="fixed inset-0 z-50 flex bg-black/70 p-2 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Notas do lead"
        className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[color:var(--color-border-gold)] bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[color:var(--color-border-gold)] px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <StickyNote size={18} className="shrink-0 text-gold" />
            <p className="truncate text-base font-semibold text-foreground">{lead ? `Notas — ${lead.name}` : "Notas do lead"}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-text-secondary hover:bg-surface-2" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {isLoading && <p className="text-sm text-text-secondary">Carregando...</p>}
          {error && <p className="text-sm text-danger">{error instanceof FetchError ? error.message : "Não foi possível carregar as notas."}</p>}

          {lead && (
            <>
              <LeadInfo lead={lead} />

              <section className="mt-6">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Evolução do atendimento</h2>

                <div className="mt-3 rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 p-3">
                  <Textarea
                    rows={3}
                    placeholder="Escreva uma nova nota sobre este atendimento..."
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="text-sm"
                  />
                  {saveError && <p className="mt-1 text-xs text-danger">{saveError}</p>}
                  <Button className="mt-2 py-2 text-xs" disabled={saving || !draft.trim()} onClick={addNote}>
                    <Send size={13} />
                    {saving ? "Salvando..." : "Adicionar nota"}
                  </Button>
                </div>

                {data.notes.length === 0 ? (
                  <p className="mt-4 text-sm text-text-secondary">Nenhuma nota ainda. A primeira nota que você escrever aparece aqui.</p>
                ) : (
                  <ol className="relative mt-4 space-y-3 before:absolute before:bottom-2 before:left-[4px] before:top-2 before:w-px before:bg-[color:var(--color-border-gold)]">
                    {data.notes.map((note) => (
                      <NoteItem key={`${note.id}-${note.editedAt ?? ""}`} note={note} leadId={leadId} onChanged={refresh} />
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

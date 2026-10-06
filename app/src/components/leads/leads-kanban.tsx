"use client";

import { useEffect, useState } from "react";
import type { DragEvent } from "react";
import useSWR from "swr";
import { Phone, MessageCircle, ArrowRightLeft, Check, X, Timer, StickyNote, BellRing } from "lucide-react";
import { fetcher, poster, FetchError } from "@/lib/fetcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LostReturnDialog } from "@/components/leads/lost-return-dialog";
import { LeadNotesDialog } from "@/components/leads/lead-notes-dialog";
import { formatTimeUntilReturn, formatTimeUntilReminder, type LostReturnPeriod } from "@/lib/lost-return";
import { formatBrasilia } from "@/lib/brasilia-time";

type WalletLead = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  campaignName: string | null;
  customFields: Record<string, unknown>;
  status: string;
  notes: string | null;
  updatedAt: string;
  /** Só vem preenchido no kanban do dono/admin (várias carteiras juntas). */
  brokerName?: string | null;
  /** Lead em "Perdido" com retorno agendado para a roleta (data salva no banco). */
  returnToRotationAt?: string | null;
  /** Lead em "Remarketing" com lembrete agendado para o corretor (data salva no banco). */
  remarketingNotifyAt?: string | null;
  /** Quantidade de notas na timeline — decide "Ver Notas" x "Adicionar Notas". */
  noteCount?: number;
};

type WalletResponse = { leads: WalletLead[] };

const COLUMNS: { status: string; label: string }[] = [
  { status: "IN_PROGRESS", label: "Em andamento" },
  { status: "QUALIFIED", label: "Qualificado" },
  { status: "SCHEDULED", label: "Agendado" },
  { status: "CONVERTED", label: "Convertido" },
  { status: "LOST", label: "Perdido" },
  { status: "REMARKETING", label: "Remarketing" },
];

/**
 * Contador do card: em "Perdido", quanto falta para o lead voltar à roleta; em "Remarketing",
 * quanto falta para o lembrete do corretor. Calculado a partir da data salva no banco (não é
 * um cronômetro local), então sobrevive a recarregar a página, trocar de aparelho ou fazer
 * logout. Reavalia a cada 30s; o kanban ainda recarrega os dados a cada 5s, então o contador
 * some sozinho quando o lead volta para a roleta / o lembrete é enviado.
 */
function ScheduleCountdown({ at, kind }: { at: string; kind: "return" | "reminder" }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const date = new Date(at);
  const when = `${formatBrasilia(date, "dd/MM/yyyy")} às ${formatBrasilia(date, "HH:mm")}`;
  const Icon = kind === "return" ? Timer : BellRing;
  return (
    <p
      className="mt-2 flex items-center gap-1.5 rounded-lg bg-gold-soft px-2 py-1.5 text-xs font-medium text-gold"
      title={kind === "return" ? `Volta para a roleta em ${when}` : `Lembrete para o corretor em ${when}`}
    >
      <Icon size={13} className="shrink-0" />
      {kind === "return" ? formatTimeUntilReturn(date, now) : formatTimeUntilReminder(date, now)}
    </p>
  );
}

function whatsappLink(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

/**
 * Telinha de "Mudar Status": alternativa ao arrastar (que não funciona bem no celular) —
 * lista as colunas do kanban e move o lead para a escolhida.
 */
function ChangeStatusDialog({
  lead,
  onClose,
  onSelect,
}: {
  lead: WalletLead;
  onClose: () => void;
  onSelect: (status: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Mudar status de ${lead.name}`}
        className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border-gold)] bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Mudar status</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-2"
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mt-0.5 truncate text-xs text-text-secondary">{lead.name}</p>

        <div className="mt-3 space-y-1.5">
          {COLUMNS.map((col) => {
            const current = col.status === lead.status;
            return (
              <button
                key={col.status}
                type="button"
                disabled={current}
                onClick={() => onSelect(col.status)}
                className={[
                  "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition-colors",
                  current
                    ? "border-[color:var(--color-border-gold-strong)] bg-gold-soft text-foreground"
                    : "border-[color:var(--color-border-gold)] bg-surface-2 text-foreground hover:border-[color:var(--color-border-gold-strong)]",
                ].join(" ")}
              >
                {col.label}
                {current && <Check size={15} className="text-gold" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KanbanCard({
  lead,
  onDragStart,
  onSaved,
  onMove,
}: {
  lead: WalletLead;
  onDragStart: (e: DragEvent<HTMLDivElement>, leadId: string) => void;
  onSaved: () => void;
  onMove: (leadId: string, status: string) => void;
}) {
  const wa = whatsappLink(lead.phone);
  const [changingStatus, setChangingStatus] = useState(false);
  const [viewingNotes, setViewingNotes] = useState(false);
  const hasNotes = (lead.noteCount ?? 0) > 0 || Boolean(lead.notes?.trim());

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      className="cursor-grab rounded-xl border border-[color:var(--color-border-gold)] bg-surface p-3 active:cursor-grabbing"
    >
      <p className="text-sm font-medium text-foreground">{lead.name}</p>
      {lead.brokerName && <p className="mt-0.5 text-xs text-gold">Corretor: {lead.brokerName}</p>}
      <div className="mt-1 space-y-0.5 text-xs text-text-secondary">
        {lead.phone && <p>{lead.phone}</p>}
        {lead.email && (
          <a href={`mailto:${lead.email}`} className="block truncate hover:text-gold" title={lead.email}>
            {lead.email}
          </a>
        )}
        {lead.campaignName && <p className="truncate">Campanha: {lead.campaignName}</p>}
      </div>

      {lead.status === "LOST" && lead.returnToRotationAt && <ScheduleCountdown at={lead.returnToRotationAt} kind="return" />}
      {lead.status === "REMARKETING" && lead.remarketingNotifyAt && (
        <ScheduleCountdown at={lead.remarketingNotifyAt} kind="reminder" />
      )}

      <div className="mt-2 flex flex-col gap-1.5">
        {lead.phone && (
          <a href={`tel:${lead.phone}`}>
            <Button variant="secondary" className="w-full py-1.5 text-xs">
              <Phone size={13} />
              Ligar
            </Button>
          </a>
        )}
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer">
            <Button variant="secondary" className="w-full py-1.5 text-xs">
              <MessageCircle size={13} />
              WhatsApp
            </Button>
          </a>
        )}
        <Button variant="secondary" className="w-full py-1.5 text-xs" onClick={() => setChangingStatus(true)}>
          <ArrowRightLeft size={13} />
          Mudar Status
        </Button>
        <Button variant="secondary" className="w-full py-1.5 text-xs" onClick={() => setViewingNotes(true)}>
          <StickyNote size={13} />
          {hasNotes ? `Ver Notas (${lead.noteCount ?? 1})` : "Adicionar Notas"}
        </Button>
      </div>

      {viewingNotes && <LeadNotesDialog leadId={lead.id} onClose={() => setViewingNotes(false)} onChanged={onSaved} />}

      {changingStatus && (
        <ChangeStatusDialog
          lead={lead}
          onClose={() => setChangingStatus(false)}
          onSelect={(status) => {
            setChangingStatus(false);
            onMove(lead.id, status);
          }}
        />
      )}
      {/* O campo de observação que ficava aqui saiu do card: as notas (inclusive as antigas,
          como "Observação do card") ficam todas em "Ver Notas", com histórico. */}
    </div>
  );
}

/**
 * Kanban de carteira (colunas por status, arrastar pra mudar). Usado pelo corretor em
 * /broker/wallet e pelo dono/admin em /kanban, que vê a carteira de qualquer corretor —
 * as rotas de status e de observação já liberam OWNER/ADMIN em qualquer lead da organização.
 */
export function LeadsKanban({ endpoint, emptyMessage }: { endpoint: string; emptyMessage: string }) {
  const { data, mutate, isLoading } = useSWR<WalletResponse>(endpoint, fetcher, {
    refreshInterval: 5000,
  });
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Movimento que precisa de prazo antes de ir para o servidor: "Perdido" (retorno à roleta)
  // ou "Remarketing" (lembrete para o corretor).
  const [pendingSchedule, setPendingSchedule] = useState<{ lead: WalletLead; status: "LOST" | "REMARKETING" } | null>(
    null
  );

  const leads = data?.leads ?? [];

  function handleDragStart(e: DragEvent<HTMLDivElement>, leadId: string) {
    e.dataTransfer.setData("text/plain", leadId);
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>, targetStatus: string) {
    e.preventDefault();
    setDragOverStatus(null);
    await moveLead(e.dataTransfer.getData("text/plain"), targetStatus);
  }

  /**
   * Usado tanto pelo arrastar quanto pelo botão "Mudar Status". Mover para "Perdido" pergunta
   * em quanto tempo o lead volta para a roleta; para "Remarketing", quando reenviar a
   * notificação para o corretor (LostReturnDialog nos dois casos).
   */
  async function moveLead(leadId: string, targetStatus: string) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === targetStatus) return;
    if (targetStatus === "LOST" || targetStatus === "REMARKETING") {
      setPendingSchedule({ lead, status: targetStatus });
      return;
    }
    await submitMove(leadId, targetStatus);
  }

  async function submitMove(leadId: string, targetStatus: string, returnPeriod?: LostReturnPeriod) {
    setErrorMsg(null);
    const optimistic = leads.map((l) => (l.id === leadId ? { ...l, status: targetStatus } : l));
    mutate({ leads: optimistic }, false);

    try {
      await poster(`/api/leads/${leadId}/status`, { status: targetStatus, returnPeriod });
      mutate();
    } catch (err) {
      setErrorMsg(err instanceof FetchError ? err.message : "Não foi possível mover o lead.");
      mutate();
    }
  }

  return (
    <div>
      {errorMsg && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{errorMsg}</p>}

      {pendingSchedule && (
        <LostReturnDialog
          leadName={pendingSchedule.lead.name}
          title={
            pendingSchedule.status === "LOST"
              ? "Em quanto tempo esse lead volta para a roleta?"
              : "Quando reenviar a notificação para o corretor?"
          }
          onCancel={() => setPendingSchedule(null)}
          onConfirm={(period) => {
            const { lead, status } = pendingSchedule;
            setPendingSchedule(null);
            void submitMove(lead.id, status, period);
          }}
        />
      )}

      {isLoading ? (
        <p className="mt-6 text-text-secondary">Carregando...</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {COLUMNS.map((col) => {
            const columnLeads = leads.filter((l) => l.status === col.status);
            return (
              <div
                key={col.status}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverStatus(col.status);
                }}
                onDragLeave={() => setDragOverStatus((s) => (s === col.status ? null : s))}
                onDrop={(e) => handleDrop(e, col.status)}
                className={[
                  "min-h-[200px] rounded-2xl border p-3 transition-colors",
                  dragOverStatus === col.status
                    ? "border-[color:var(--color-border-gold-strong)] bg-gold-soft"
                    : "border-[color:var(--color-border-gold)] bg-surface-2",
                ].join(" ")}
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground">{col.label}</p>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-text-secondary">
                    {columnLeads.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {columnLeads.map((lead) => (
                    <KanbanCard
                      key={lead.id}
                      lead={lead}
                      onDragStart={handleDragStart}
                      onSaved={() => mutate()}
                      onMove={moveLead}
                    />
                  ))}
                  {columnLeads.length === 0 && (
                    <p className="px-1 py-6 text-center text-xs text-text-secondary">Nenhum lead aqui.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && leads.length === 0 && (
        <Card className="mt-6 text-center text-text-secondary">
          {emptyMessage}
        </Card>
      )}
    </div>
  );
}

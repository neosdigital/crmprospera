"use client";

import { useState } from "react";
import type { DragEvent } from "react";
import { Phone, MessageCircle, StickyNote, BellRing } from "lucide-react";
import { patcher, FetchError } from "@/lib/fetcher";
import { formatBrasilia } from "@/lib/brasilia-time";
import { formatTimeUntilReminder, type LostReturnPeriod } from "@/lib/lost-return";
import { Button } from "@/components/ui/button";
import { LostReturnDialog } from "@/components/leads/lost-return-dialog";
import { PERSONAL_COLUMNS, whatsappLink, type PersonalLeadRow } from "./shared";

/**
 * Kanban da carteira particular. Componente próprio (não reaproveita o LeadsKanban da
 * carteira geral, que fala com as rotas de leads da roleta) para os dois nunca se misturarem.
 */
export function PersonalKanban({
  leads,
  onChanged,
  onOpen,
}: {
  leads: PersonalLeadRow[];
  onChanged: () => void;
  onOpen: (leadId: string) => void;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingReminder, setPendingReminder] = useState<PersonalLeadRow | null>(null);

  async function move(leadId: string, status: string, reminderPeriod?: LostReturnPeriod) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === status) return;
    if (status === "REMARKETING" && !reminderPeriod) return setPendingReminder(lead);
    setError(null);
    try {
      await patcher(`/api/personal/leads/${leadId}`, { status, reminderPeriod });
    } catch (err) {
      setError(err instanceof FetchError ? err.message : "Não foi possível mover o lead.");
    } finally {
      onChanged();
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>, status: string) {
    e.preventDefault();
    setDragOver(null);
    void move(e.dataTransfer.getData("text/plain"), status);
  }

  return (
    <div>
      {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
        {PERSONAL_COLUMNS.map((col) => {
          const columnLeads = leads.filter((l) => l.status === col.status);
          return (
            <div
              key={col.status}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(col.status);
              }}
              onDragLeave={() => setDragOver((s) => (s === col.status ? null : s))}
              onDrop={(e) => onDrop(e, col.status)}
              className={[
                "min-h-[200px] w-64 shrink-0 rounded-2xl border p-3 transition-colors",
                dragOver === col.status
                  ? "border-[color:var(--color-border-gold-strong)] bg-gold-soft"
                  : "border-[color:var(--color-border-gold)] bg-surface-2",
              ].join(" ")}
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground">{col.label}</p>
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-text-secondary">{columnLeads.length}</span>
              </div>
              <div className="space-y-2">
                {columnLeads.map((lead) => {
                  const wa = whatsappLink(lead.phone);
                  return (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", lead.id)}
                      className="cursor-grab rounded-xl border border-[color:var(--color-border-gold)] bg-surface p-3 active:cursor-grabbing"
                    >
                      <button type="button" onClick={() => onOpen(lead.id)} className="text-left text-sm font-medium text-foreground hover:text-gold">
                        {lead.name}
                      </button>
                      {lead.brokerName && <p className="mt-0.5 text-xs text-gold">Corretor: {lead.brokerName}</p>}
                      <div className="mt-1 space-y-0.5 text-xs text-text-secondary">
                        {lead.phone && <p>{lead.phone}</p>}
                        {lead.campaignName && <p className="truncate">Campanha: {lead.campaignName}</p>}
                        <p>Entrada: {formatBrasilia(lead.createdAt, "dd/MM/yyyy HH:mm")}</p>
                      </div>
                      {lead.status === "REMARKETING" && lead.remarketingNotifyAt && (
                        <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-gold-soft px-2 py-1.5 text-xs font-medium text-gold">
                          <BellRing size={13} />
                          {formatTimeUntilReminder(new Date(lead.remarketingNotifyAt))}
                        </p>
                      )}
                      <div className="mt-2 flex gap-1.5">
                        {lead.phone && (
                          <a href={`tel:${lead.phone}`} className="flex-1">
                            <Button variant="secondary" className="w-full px-2 py-1.5 text-xs" aria-label="Ligar">
                              <Phone size={13} />
                            </Button>
                          </a>
                        )}
                        {wa && (
                          <a href={wa} target="_blank" rel="noreferrer" className="flex-1">
                            <Button variant="secondary" className="w-full px-2 py-1.5 text-xs" aria-label="WhatsApp">
                              <MessageCircle size={13} />
                            </Button>
                          </a>
                        )}
                        <Button variant="secondary" className="flex-1 px-2 py-1.5 text-xs" onClick={() => onOpen(lead.id)}>
                          <StickyNote size={13} />
                          {lead.noteCount > 0 ? lead.noteCount : ""}
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {columnLeads.length === 0 && <p className="px-1 py-6 text-center text-xs text-text-secondary">Nenhum lead aqui.</p>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-text-secondary">No celular, toque no lead para mudar a etapa.</p>

      {pendingReminder && (
        <LostReturnDialog
          leadName={pendingReminder.name}
          title="Quando você quer ser lembrado deste lead?"
          onCancel={() => setPendingReminder(null)}
          onConfirm={(period) => {
            const lead = pendingReminder;
            setPendingReminder(null);
            void move(lead.id, "REMARKETING", period);
          }}
        />
      )}
    </div>
  );
}

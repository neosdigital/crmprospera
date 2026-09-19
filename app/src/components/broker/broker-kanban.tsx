"use client";

import { useState } from "react";
import type { DragEvent } from "react";
import useSWR from "swr";
import { Phone, MessageCircle } from "lucide-react";
import { fetcher, poster, FetchError } from "@/lib/fetcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LeadNotesEditor } from "@/components/leads/lead-notes-editor";

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
};

type WalletResponse = { leads: WalletLead[] };

const COLUMNS: { status: string; label: string }[] = [
  { status: "IN_PROGRESS", label: "Em andamento" },
  { status: "QUALIFIED", label: "Qualificado" },
  { status: "SCHEDULED", label: "Agendado" },
  { status: "CONVERTED", label: "Convertido" },
  { status: "LOST", label: "Perdido" },
];

function whatsappLink(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

function KanbanCard({
  lead,
  onDragStart,
  onSaved,
}: {
  lead: WalletLead;
  onDragStart: (e: DragEvent<HTMLDivElement>, leadId: string) => void;
  onSaved: () => void;
}) {
  const wa = whatsappLink(lead.phone);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      className="cursor-grab rounded-xl border border-[color:var(--color-border-gold)] bg-surface p-3 active:cursor-grabbing"
    >
      <p className="text-sm font-medium text-foreground">{lead.name}</p>
      <div className="mt-1 space-y-0.5 text-xs text-text-secondary">
        {lead.phone && <p>{lead.phone}</p>}
        {lead.campaignName && <p className="truncate">Campanha: {lead.campaignName}</p>}
      </div>

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
      </div>

      <div className="mt-3 border-t border-[color:var(--color-border-gold)]/40 pt-3">
        <LeadNotesEditor leadId={lead.id} initialNotes={lead.notes} onSaved={onSaved} compact />
      </div>
    </div>
  );
}

export function BrokerKanban() {
  const { data, mutate, isLoading } = useSWR<WalletResponse>("/api/broker/wallet", fetcher, {
    refreshInterval: 5000,
  });
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const leads = data?.leads ?? [];

  function handleDragStart(e: DragEvent<HTMLDivElement>, leadId: string) {
    e.dataTransfer.setData("text/plain", leadId);
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>, targetStatus: string) {
    e.preventDefault();
    setDragOverStatus(null);
    const leadId = e.dataTransfer.getData("text/plain");
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === targetStatus) return;

    setErrorMsg(null);
    const optimistic = leads.map((l) => (l.id === leadId ? { ...l, status: targetStatus } : l));
    mutate({ leads: optimistic }, false);

    try {
      await poster(`/api/leads/${leadId}/status`, { status: targetStatus });
      mutate();
    } catch (err) {
      setErrorMsg(err instanceof FetchError ? err.message : "Não foi possível mover o lead.");
      mutate();
    }
  }

  return (
    <div className="px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Minha carteira</h1>
      <p className="mt-1 text-text-secondary">
        Arraste os cards entre as colunas para atualizar o andamento de cada lead.
      </p>
      {errorMsg && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{errorMsg}</p>}

      {isLoading ? (
        <p className="mt-6 text-text-secondary">Carregando...</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
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
                    <KanbanCard key={lead.id} lead={lead} onDragStart={handleDragStart} onSaved={() => mutate()} />
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
          Sua carteira ainda não tem leads. Quando você entrar em contato com um lead a tempo, ele aparece aqui.
        </Card>
      )}
    </div>
  );
}

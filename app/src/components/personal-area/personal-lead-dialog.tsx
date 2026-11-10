"use client";

import { useState } from "react";
import useSWR from "swr";
import { X, Phone, MessageCircle, Mail } from "lucide-react";
import { fetcher, poster, patcher, FetchError } from "@/lib/fetcher";
import { formatBrasilia } from "@/lib/brasilia-time";
import { formatMetaFieldText } from "@/lib/format-text";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { LostReturnDialog } from "@/components/leads/lost-return-dialog";
import type { LostReturnPeriod } from "@/lib/lost-return";
import { PERSONAL_COLUMNS, personalStatusLabel, sourceLabel, whatsappLink } from "./shared";

type Detail = {
  lead: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    status: string;
    sourceType: string;
    platform: string | null;
    pageId: string | null;
    adAccountId: string | null;
    campaignId: string | null;
    campaignName: string | null;
    adsetName: string | null;
    adName: string | null;
    formId: string | null;
    formName: string | null;
    metaLeadId: string | null;
    customFields: Record<string, string>;
    remarketingNotifyAt: string | null;
    createdAt: string;
    receivedAt: string;
    brokerName: string | null;
  };
  notes: { id: string; content: string; createdAt: string; authorName: string | null }[];
  events: { id: string; type: string; metadata: Record<string, unknown>; createdAt: string; userName: string | null }[];
};

function when(date: string) {
  return `${formatBrasilia(date, "dd/MM/yyyy")} às ${formatBrasilia(date, "HH:mm")}`;
}

function eventText(e: Detail["events"][number]) {
  switch (e.type) {
    case "RECEIVED":
      return "Lead recebido da campanha particular";
    case "STATUS_CHANGED":
      return `Etapa: ${personalStatusLabel(String(e.metadata.from ?? ""))} → ${personalStatusLabel(String(e.metadata.to ?? ""))}`;
    case "NOTE_ADDED":
      return "Nota adicionada";
    case "REMINDER_SENT":
      return "Lembrete de remarketing enviado";
    default:
      return e.type;
  }
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-0.5 break-words text-sm text-foreground">{value}</p>
    </div>
  );
}

/** Detalhes do lead particular: contato, origem, etapa, notas, lembrete e histórico. */
export function PersonalLeadDialog({ leadId, onClose, onChanged }: { leadId: string; onClose: () => void; onChanged: () => void }) {
  const { data, mutate, isLoading } = useSWR<Detail>(`/api/personal/leads/${leadId}`, fetcher);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [askReminder, setAskReminder] = useState(false);

  async function changeStatus(status: string, reminderPeriod?: LostReturnPeriod) {
    if (status === "REMARKETING" && !reminderPeriod) return setAskReminder(true);
    setError(null);
    try {
      await patcher(`/api/personal/leads/${leadId}`, { status, reminderPeriod });
      await mutate();
      onChanged();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : "Não foi possível mudar a etapa.");
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await poster(`/api/personal/leads/${leadId}/notes`, { content: note });
      setNote("");
      await mutate();
      onChanged();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : "Não foi possível salvar a nota.");
    } finally {
      setSaving(false);
    }
  }

  const lead = data?.lead;
  const wa = whatsappLink(lead?.phone ?? null);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[color:var(--color-border-gold)] bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-foreground">{lead?.name ?? "Carregando..."}</p>
            {lead && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge tone="gold">{sourceLabel(lead.sourceType)}</Badge>
                <Badge>{personalStatusLabel(lead.status)}</Badge>
                {lead.brokerName && <span className="text-xs text-text-secondary">Corretor: {lead.brokerName}</span>}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-2" aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        {isLoading || !lead ? (
          <p className="mt-6 text-text-secondary">Carregando...</p>
        ) : (
          <div className="mt-5 space-y-5">
            <div className="flex flex-wrap gap-2">
              {lead.phone && (
                <a href={`tel:${lead.phone}`}>
                  <Button variant="secondary" className="py-1.5 text-xs">
                    <Phone size={13} /> {lead.phone}
                  </Button>
                </a>
              )}
              {wa && (
                <a href={wa} target="_blank" rel="noreferrer">
                  <Button variant="secondary" className="py-1.5 text-xs">
                    <MessageCircle size={13} /> WhatsApp
                  </Button>
                </a>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`}>
                  <Button variant="secondary" className="py-1.5 text-xs">
                    <Mail size={13} /> {lead.email}
                  </Button>
                </a>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Info label="Campanha" value={lead.campaignName} />
              <Info label="Conjunto" value={lead.adsetName} />
              <Info label="Anúncio" value={lead.adName} />
              <Info label="Formulário" value={lead.formName ?? lead.formId} />
              <Info label="Página" value={lead.pageId} />
              <Info label="Conta de anúncios" value={lead.adAccountId} />
              <Info label="Gerado na Meta em" value={when(lead.createdAt)} />
              <Info label="Recebido no CRM em" value={when(lead.receivedAt)} />
              <Info label="ID do lead na Meta" value={lead.metaLeadId} />
              {lead.remarketingNotifyAt && <Info label="Lembrete agendado" value={when(lead.remarketingNotifyAt)} />}
            </div>

            {Object.keys(lead.customFields ?? {}).length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Respostas do formulário</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {Object.entries(lead.customFields).map(([k, v]) => (
                    <Info key={k} label={formatMetaFieldText(k)} value={formatMetaFieldText(String(v))} />
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Etapa</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PERSONAL_COLUMNS.map((c) => (
                  <button
                    key={c.status}
                    type="button"
                    disabled={c.status === lead.status}
                    onClick={() => changeStatus(c.status)}
                    className={[
                      "rounded-full border px-3 py-1 text-xs",
                      c.status === lead.status
                        ? "border-[color:var(--color-border-gold-strong)] bg-gold-soft text-gold"
                        : "border-[color:var(--color-border-gold)] bg-surface-2 text-text-secondary hover:text-foreground",
                    ].join(" ")}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-text-secondary">
                Para criar um lembrete, mova o lead para Remarketing e escolha quando ser avisado.
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Notas</p>
              <Textarea className="mt-2" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Escreva uma nota..." maxLength={5000} />
              <Button className="mt-2" onClick={addNote} disabled={saving || !note.trim()}>
                {saving ? "Salvando..." : "Adicionar nota"}
              </Button>
              <div className="mt-3 space-y-2">
                {data.notes.map((n) => (
                  <div key={n.id} className="rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 p-3">
                    <p className="whitespace-pre-wrap text-sm text-foreground">{n.content}</p>
                    <p className="mt-1 text-xs text-text-secondary">
                      {n.authorName ?? "—"} · {when(n.createdAt)}
                    </p>
                  </div>
                ))}
                {data.notes.length === 0 && <p className="text-xs text-text-secondary">Nenhuma nota ainda.</p>}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Histórico</p>
              <ul className="mt-2 space-y-1.5">
                {data.events.map((e) => (
                  <li key={e.id} className="text-sm text-text-secondary">
                    <span className="text-foreground">{eventText(e)}</span> · {when(e.createdAt)}
                    {e.userName ? ` · ${e.userName}` : ""}
                  </li>
                ))}
              </ul>
            </div>

            {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          </div>
        )}

        {askReminder && lead && (
          <LostReturnDialog
            leadName={lead.name}
            title="Quando você quer ser lembrado deste lead?"
            onCancel={() => setAskReminder(false)}
            onConfirm={(period) => {
              setAskReminder(false);
              void changeStatus("REMARKETING", period);
            }}
          />
        )}
      </div>
    </div>
  );
}

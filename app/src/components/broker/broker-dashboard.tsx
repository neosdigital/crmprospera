"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Phone, MessageCircle, Clock } from "lucide-react";
import { fetcher, poster, FetchError } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNewItemAlert, showLeadNotification } from "@/hooks/use-new-item-alert";
import { NotificationPermissionBanner } from "@/components/notifications/notification-permission-banner";

type LeadAssignment = {
  id: string;
  leadId: string;
  assignedAt: string;
  expiresAt: string;
  attemptNumber: number;
  lead: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    campaignName: string | null;
    adName: string | null;
    formName: string | null;
    customFields: Record<string, string>;
    createdAt: string;
  };
};

type MyLeadsResponse = {
  activeAssignments: LeadAssignment[];
  recentHistory: { id: string; status: string; lead: { name: string; phone: string | null; status: string } }[];
  soundEnabled: boolean;
  serverNow: string;
};

function whatsappLink(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

function useCountdown(expiresAt: string, serverOffsetMs: number) {
  const [remainingMs, setRemainingMs] = useState(() => new Date(expiresAt).getTime() - (Date.now() + serverOffsetMs));

  useEffect(() => {
    const tick = () => setRemainingMs(new Date(expiresAt).getTime() - (Date.now() + serverOffsetMs));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, serverOffsetMs]);

  return remainingMs;
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function LeadCard({ assignment, serverOffsetMs, onClaim }: { assignment: LeadAssignment; serverOffsetMs: number; onClaim: (id: string) => void }) {
  const remainingMs = useCountdown(assignment.expiresAt, serverOffsetMs);
  const expired = remainingMs <= 0;
  const critical = remainingMs <= 30_000 && !expired;
  const warning = remainingMs <= 60_000 && !expired;
  const [claiming, setClaiming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const wa = whatsappLink(assignment.lead.phone);

  async function handleClaim() {
    setClaiming(true);
    setErrorMsg(null);
    try {
      await poster(`/api/leads/${assignment.leadId}/claim`);
      onClaim(assignment.id);
    } catch (err) {
      if (err instanceof FetchError) setErrorMsg(err.message);
      else setErrorMsg("Não foi possível registrar o contato.");
    } finally {
      setClaiming(false);
    }
  }

  const customFieldsEntries = Object.entries(assignment.lead.customFields ?? {});

  return (
    <div
      className={[
        "rounded-2xl border p-6 transition-colors",
        critical
          ? "border-danger/50 bg-danger/5"
          : warning
            ? "border-[color:var(--color-border-gold-strong)] bg-gold-soft"
            : "border-[color:var(--color-border-gold)] bg-surface",
      ].join(" ")}
    >
      <div className="mb-4 flex items-center justify-between">
        <Badge tone="gold">NOVO LEAD</Badge>
        <div className={["flex items-center gap-1.5 text-sm font-medium", critical ? "text-danger" : "text-text-secondary"].join(" ")}>
          <Clock size={14} />
          Tentativa {assignment.attemptNumber}
        </div>
      </div>

      <h2 className="text-2xl font-semibold text-foreground">{assignment.lead.name}</h2>

      <div className="mt-3 space-y-1 text-sm text-text-secondary">
        {assignment.lead.phone && <p>{assignment.lead.phone}</p>}
        {assignment.lead.email && <p>{assignment.lead.email}</p>}
        {assignment.lead.campaignName && <p>Campanha: {assignment.lead.campaignName}</p>}
      </div>

      {customFieldsEntries.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-[color:var(--color-border-gold)] pt-4">
          {customFieldsEntries.map(([q, a]) => (
            <p key={q} className="text-sm">
              <span className="text-text-secondary">{q}: </span>
              <span className="text-foreground">{String(a)}</span>
            </p>
          ))}
        </div>
      )}

      <div className="mt-6 text-center">
        <p className="text-xs uppercase tracking-wide text-text-secondary">
          {expired ? "Tempo esgotado — transferindo..." : "Tempo restante"}
        </p>
        <p
          className={[
            "mt-1 font-mono text-5xl font-bold tabular-nums",
            expired ? "text-danger" : critical ? "text-danger" : warning ? "text-gold" : "text-foreground",
          ].join(" ")}
        >
          {expired ? "00:00" : formatCountdown(remainingMs)}
        </p>
      </div>

      {errorMsg && <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{errorMsg}</p>}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button className="flex-1 py-3 text-base" disabled={expired || claiming} onClick={handleClaim}>
          <Phone size={18} />
          {claiming ? "Registrando..." : "ENTRAR EM CONTATO"}
        </Button>
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer" className="flex-1">
            <Button variant="secondary" className="w-full py-3 text-base">
              <MessageCircle size={18} />
              WhatsApp
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}

export function BrokerDashboard({ brokerFirstName }: { brokerFirstName: string }) {
  const { data, mutate, isLoading } = useSWR<MyLeadsResponse>("/api/broker/my-leads", fetcher, {
    refreshInterval: 3000,
    revalidateOnFocus: true,
  });

  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  useEffect(() => {
    const syncOffset = () => {
      if (data?.serverNow) setServerOffsetMs(new Date(data.serverNow).getTime() - Date.now());
    };
    syncOffset();
  }, [data?.serverNow]);

  const active = data?.activeAssignments ?? [];

  useNewItemAlert(
    active.map((a) => a.id),
    {
      soundEnabled: data?.soundEnabled ?? true,
      notify: (newIds) => {
        const first = active.find((a) => newIds.includes(a.id));
        if (first) showLeadNotification("Novo lead recebido", `${first.lead.name} está aguardando atendimento.`);
      },
    }
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <NotificationPermissionBanner />
      <h1 className="text-2xl font-semibold text-foreground">Olá, {brokerFirstName}.</h1>
      <p className="mt-1 text-text-secondary">
        {isLoading
          ? "Carregando seus leads..."
          : active.length === 0
            ? "Você não possui leads aguardando atendimento no momento."
            : active.length === 1
              ? "Você possui 1 lead aguardando atendimento."
              : `Você possui ${active.length} leads aguardando atendimento.`}
      </p>

      <div className="mt-6 space-y-5">
        {active.map((assignment) => (
          <LeadCard
            key={assignment.id}
            assignment={assignment}
            serverOffsetMs={serverOffsetMs}
            onClaim={() => mutate()}
          />
        ))}

        {!isLoading && active.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[color:var(--color-border-gold)] p-10 text-center">
            <p className="text-text-secondary">
              Quando um novo lead chegar pelo Meta Ads e for atribuído a você, ele aparecerá aqui
              automaticamente.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

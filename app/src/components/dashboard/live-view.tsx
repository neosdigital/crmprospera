"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Phone, Mail, Megaphone, Users } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { Card, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNewItemAlert, showLeadNotification } from "@/hooks/use-new-item-alert";
import { NotificationPermissionBanner } from "@/components/notifications/notification-permission-banner";
import { leadStatusLabel } from "@/lib/labels";
import { SendTestLeadButton } from "@/components/leads/send-test-lead-button";
import { formatMetaFieldText } from "@/lib/format-text";

type LiveLead = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  campaignName: string | null;
  customFields: Record<string, unknown>;
  status: string;
  brokerName: string | null;
  assignedAt: string | null;
  expiresAt: string | null;
  brokersPassedCount: number;
  brokersPassedNames: string[];
};

type LiveResponse = {
  activeLeads: LiveLead[];
  recentlyExpired: { id: string; name: string }[];
  serverNow: string;
};

function computeTimerState(assignedAt: string | null, expiresAt: string | null, offsetMs: number) {
  if (!assignedAt || !expiresAt) return null;
  const now = Date.now() + offsetMs;
  const start = new Date(assignedAt).getTime();
  const end = new Date(expiresAt).getTime();
  const totalMs = Math.max(1, end - start);
  const remainingMs = end - now;
  const remainingFraction = Math.min(1, Math.max(0, remainingMs / totalMs));
  return { remainingMs, remainingFraction };
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function useTimerState(assignedAt: string | null, expiresAt: string | null, offsetMs: number) {
  const [state, setState] = useState(() => computeTimerState(assignedAt, expiresAt, offsetMs));

  useEffect(() => {
    const tick = () => setState(computeTimerState(assignedAt, expiresAt, offsetMs));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [assignedAt, expiresAt, offsetMs]);

  return state;
}

function VisualTimer({ assignedAt, expiresAt, offsetMs }: { assignedAt: string | null; expiresAt: string | null; offsetMs: number }) {
  const timer = useTimerState(assignedAt, expiresAt, offsetMs);
  if (!timer) return null;

  const { remainingMs, remainingFraction } = timer;
  const expired = remainingMs <= 0;
  const critical = remainingFraction <= 0.2;
  const warning = remainingFraction <= 0.5;
  const barColor = expired || critical ? "bg-danger" : warning ? "bg-gold" : "bg-success";
  const textColor = expired || critical ? "text-danger" : warning ? "text-gold" : "text-success";

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-text-secondary">Tempo restante</p>
        <p className={["font-mono text-sm font-semibold tabular-nums", textColor].join(" ")}>
          {expired ? "00:00" : formatCountdown(remainingMs)}
        </p>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={["h-full rounded-full transition-[width] duration-1000 ease-linear", barColor].join(" ")}
          style={{ width: `${expired ? 0 : remainingFraction * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Resumo compacto do fluxo: mostra a contagem total + só os últimos 3 corretores que não
 * atenderam a tempo mais o atual (4 nomes no máximo), com "..." indicando que o começo do
 * fluxo foi omitido. Leads que dão muitas voltas (dezenas/centenas de tentativas) deixavam
 * essa área do card ilegível mostrando a cadeia inteira — o fluxo completo continua acessível
 * clicando em "Ver todo o fluxo".
 */
function BrokersPassedSummary({ count, names }: { count: number; names: string[] }) {
  const [expanded, setExpanded] = useState(false);

  if (count <= 1) {
    return (
      <div className="mt-3 flex items-center gap-1.5 text-xs text-text-secondary">
        <Users size={12} />
        Ainda no 1º corretor
      </div>
    );
  }

  const RECENT_COUNT = 4; // 3 que expiraram + o atual
  const recent = names.slice(-RECENT_COUNT);
  const truncated = names.length > RECENT_COUNT;

  return (
    <div className="mt-3 text-xs text-text-secondary">
      <div className="flex items-center gap-1.5">
        <Users size={12} />
        <span>
          Já passou por {count} corretores ({truncated ? "... → " : ""}
          {recent.join(" → ")})
        </span>
      </div>
      {truncated && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-gold underline underline-offset-2 hover:text-gold/80"
        >
          {expanded ? "Ocultar fluxo" : "Ver todo o fluxo"}
        </button>
      )}
      {expanded && <p className="mt-1.5 break-words text-text-secondary">{names.join(" → ")}</p>}
    </div>
  );
}

function LiveCard({ lead, offsetMs }: { lead: LiveLead; offsetMs: number }) {
  const statusTone = lead.status === "ASSIGNED" ? "gold" : lead.status === "IN_PROGRESS" ? "success" : "neutral";
  const customFieldsEntries = Object.entries(lead.customFields ?? {});

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-foreground">{lead.name}</p>
        <Badge tone={statusTone}>{leadStatusLabel(lead.status)}</Badge>
      </div>
      <p className="mt-1 text-sm text-text-secondary">→ {lead.brokerName ?? "sem corretor"}</p>

      <div className="mt-3 space-y-1 text-xs text-text-secondary">
        {lead.phone && (
          <p className="flex items-center gap-1.5">
            <Phone size={12} /> {lead.phone}
          </p>
        )}
        {lead.email && (
          <p className="flex items-center gap-1.5">
            <Mail size={12} /> {lead.email}
          </p>
        )}
        {lead.campaignName && (
          <p className="flex items-center gap-1.5">
            <Megaphone size={12} /> {lead.campaignName}
          </p>
        )}
      </div>

      {customFieldsEntries.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-[color:var(--color-border-gold)]/40 pt-2">
          {customFieldsEntries.map(([q, a]) => (
            <p key={q} className="text-xs">
              <span className="text-text-secondary">{formatMetaFieldText(q)}: </span>
              <span className="text-foreground">{formatMetaFieldText(String(a))}</span>
            </p>
          ))}
        </div>
      )}

      <BrokersPassedSummary count={lead.brokersPassedCount} names={lead.brokersPassedNames} />

      {lead.status === "ASSIGNED" && lead.expiresAt ? (
        <VisualTimer assignedAt={lead.assignedAt} expiresAt={lead.expiresAt} offsetMs={offsetMs} />
      ) : (
        <p className="mt-3 font-mono text-xl font-semibold text-gold">
          {lead.status === "CONTACTED" ? "ENTRANDO EM CONTATO" : "EM ATENDIMENTO"}
        </p>
      )}
    </Card>
  );
}

export function LiveView() {
  const { data, mutate } = useSWR<LiveResponse>("/api/dashboard/live", fetcher, { refreshInterval: 2500 });

  const [offsetMs, setOffsetMs] = useState(0);
  useEffect(() => {
    const syncOffset = () => {
      if (data?.serverNow) setOffsetMs(new Date(data.serverNow).getTime() - Date.now());
    };
    syncOffset();
  }, [data?.serverNow]);

  const activeLeads = data?.activeLeads ?? [];
  useNewItemAlert(
    activeLeads.map((l) => l.id),
    {
      notify: (newIds) => {
        const first = activeLeads.find((l) => newIds.includes(l.id));
        if (first) showLeadNotification("Novo lead recebido", `${first.name} entrou na roleta de atendimento.`);
      },
    }
  );

  return (
    <div className="px-4 py-8 sm:px-8">
      <NotificationPermissionBanner />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Atendimento ao vivo</h1>
          <p className="mt-1 text-text-secondary">Acompanhe em tempo real onde cada lead está agora.</p>
        </div>
        <SendTestLeadButton onSent={() => mutate()} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.activeLeads.length === 0 && (
          <p className="text-text-secondary">Nenhum lead em atendimento no momento.</p>
        )}
        {data?.activeLeads.map((lead) => (
          <LiveCard key={lead.id} lead={lead} offsetMs={offsetMs} />
        ))}
      </div>

      {data && data.recentlyExpired.length > 0 && (
        <div className="mt-8">
          <CardLabel>Transferidos recentemente</CardLabel>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.recentlyExpired.map((l) => (
              <Badge key={l.id} tone="danger">
                {l.name} — transferindo...
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

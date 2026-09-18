"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { Card, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type LiveLead = {
  id: string;
  name: string;
  status: string;
  brokerName: string | null;
  expiresAt: string | null;
};

type LiveResponse = {
  activeLeads: LiveLead[];
  recentlyExpired: { id: string; name: string }[];
  serverNow: string;
};

function computeCountdownLabel(expiresAt: string | null, offsetMs: number) {
  if (!expiresAt) return "—";
  const remaining = new Date(expiresAt).getTime() - (Date.now() + offsetMs);
  if (remaining <= 0) return "expirando...";
  const totalSeconds = Math.floor(remaining / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function useCountdownLabel(expiresAt: string | null, offsetMs: number) {
  const [label, setLabel] = useState(() => computeCountdownLabel(expiresAt, offsetMs));

  useEffect(() => {
    const tick = () => setLabel(computeCountdownLabel(expiresAt, offsetMs));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, offsetMs]);

  return label;
}

function LiveCard({ lead, offsetMs }: { lead: LiveLead; offsetMs: number }) {
  const countdown = useCountdownLabel(lead.expiresAt, offsetMs);

  const statusTone = lead.status === "ASSIGNED" ? "gold" : lead.status === "IN_PROGRESS" ? "success" : "neutral";

  return (
    <Card>
      <div className="flex items-center justify-between">
        <p className="font-medium text-foreground">{lead.name}</p>
        <Badge tone={statusTone}>{lead.status}</Badge>
      </div>
      <p className="mt-2 text-sm text-text-secondary">→ {lead.brokerName ?? "sem corretor"}</p>
      <p className="mt-3 font-mono text-2xl font-semibold text-gold">
        {lead.status === "ASSIGNED" ? countdown : lead.status === "CONTACTED" ? "ENTRANDO EM CONTATO" : "—"}
      </p>
    </Card>
  );
}

export function LiveView() {
  const { data } = useSWR<LiveResponse>("/api/dashboard/live", fetcher, { refreshInterval: 2500 });

  const [offsetMs, setOffsetMs] = useState(0);
  useEffect(() => {
    const syncOffset = () => {
      if (data?.serverNow) setOffsetMs(new Date(data.serverNow).getTime() - Date.now());
    };
    syncOffset();
  }, [data?.serverNow]);

  return (
    <div className="px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Atendimento ao vivo</h1>
      <p className="mt-1 text-text-secondary">Acompanhe em tempo real onde cada lead está agora.</p>

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

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { RefreshCw, Unplug, Plus, List, Kanban as KanbanIcon, BellRing, ArrowLeft } from "lucide-react";
import { fetcher, poster, deleter, FetchError } from "@/lib/fetcher";
import { formatBrasilia } from "@/lib/brasilia-time";
import { isQuietHours } from "@/lib/quiet-hours";
import { playLeadAlertSound } from "@/lib/alerts";
import { Card, CardLabel, CardValue } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PersonalConnectForm } from "./personal-connect-form";
import { PersonalKanban } from "./personal-kanban";
import { PersonalLeadDialog } from "./personal-lead-dialog";
import {
  PERSONAL_COLUMNS,
  CONNECTION_STATUS,
  personalStatusLabel,
  sourceLabel,
  buildQuery,
  type PersonalConnection,
  type PersonalLeadRow,
} from "./shared";

type Overview = {
  kpis: { total: number; new: number; inService: number; qualified: number; converted: number; lost: number };
  campaigns: string[];
  connections: PersonalConnection[];
  latestLead: { id: string; name: string; receivedAt: string } | null;
  viewer: { isAdmin: boolean };
};

function when(date: string | null) {
  if (!date) return "—";
  return `${formatBrasilia(date, "dd/MM/yyyy")} às ${formatBrasilia(date, "HH:mm")}`;
}

function ConnectionCard({
  connection,
  canSync,
  onChanged,
}: {
  connection: PersonalConnection;
  canSync: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"sync" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const status = CONNECTION_STATUS[connection.status] ?? CONNECTION_STATUS.ERROR;

  async function sync() {
    setBusy("sync");
    setMessage(null);
    try {
      const res = await poster<{ created: number; error?: string }>(`/api/personal/connection/${connection.id}/sync`);
      setMessage(res.error ? res.error : res.created > 0 ? `${res.created} lead(s) novo(s) importado(s).` : "Nenhum lead novo.");
    } catch (err) {
      setMessage(err instanceof FetchError ? err.message : "Não foi possível sincronizar.");
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  async function disconnect() {
    if (!confirm("Desconectar esta integração? Os leads já recebidos continuam na carteira particular.")) return;
    setBusy("disconnect");
    try {
      await deleter(`/api/personal/connection/${connection.id}`);
    } catch (err) {
      setMessage(err instanceof FetchError ? err.message : "Não foi possível desconectar.");
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-foreground">{connection.name}</p>
          {connection.brokerName && <p className="text-xs text-gold">Corretor: {connection.brokerName}</p>}
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p className="text-text-secondary">
          Página: <span className="text-foreground">{connection.pageName ?? connection.pageId}</span>
        </p>
        <p className="text-text-secondary">
          Conta de anúncios:{" "}
          <span className="text-foreground">
            {connection.adAccountName || connection.adAccountId ? `${connection.adAccountName ?? ""} ${connection.adAccountId ? `(${connection.adAccountId})` : ""}` : "não informada"}
          </span>
        </p>
        {connection.accountOwnerName && (
          <p className="text-text-secondary">
            Proprietário: <span className="text-foreground">{connection.accountOwnerName}</span>
          </p>
        )}
        <p className="text-text-secondary">
          Formulários: <span className="text-foreground">{connection.forms.map((f) => f.formName ?? f.formId).join(", ") || "—"}</span>
        </p>
        <p className="text-text-secondary">
          Última sincronização: <span className="text-foreground">{when(connection.lastSyncAt)}</span>
        </p>
        <p className="text-text-secondary">
          Leads recebidos: <span className="text-foreground">{connection.leadsReceived ?? 0}</span>
          {connection.lastLeadAt ? ` · último em ${when(connection.lastLeadAt)}` : ""}
        </p>
      </div>
      {connection.status === "NEEDS_RECONNECT" && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          O acesso à Meta perdeu a validade. Conecte de novo com um token novo para voltar a receber leads.
        </p>
      )}
      {connection.lastSyncError && connection.status !== "NEEDS_RECONNECT" && connection.isActive && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">Último erro: {connection.lastSyncError}</p>
      )}
      {message && <p className="text-sm text-text-secondary">{message}</p>}
      {connection.isActive && (
        <div className="flex flex-wrap gap-2">
          {canSync && (
            <Button variant="secondary" onClick={sync} disabled={busy !== null}>
              <RefreshCw size={14} />
              {busy === "sync" ? "Sincronizando..." : "Sincronizar agora"}
            </Button>
          )}
          <Button variant="danger" onClick={disconnect} disabled={busy !== null}>
            <Unplug size={14} />
            Desconectar
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Tela da Área do Corretor. `mode="broker"`: o corretor vê a própria carteira particular e
 * conecta a conta dele. `mode="admin"`: o dono/admin vê a carteira de um corretor (brokerId).
 * O servidor decide o que cada um pode ver; esta tela só exibe.
 */
export function PersonalAreaView({ mode, brokerId, brokerName }: { mode: "broker" | "admin"; brokerId?: string; brokerName?: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [campaign, setCampaign] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState<"list" | "kanban">("list");
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const base = { brokerId: mode === "admin" ? brokerId : undefined };
  const overviewKey = `/api/personal/overview${buildQuery({ ...base, from, to })}`;
  const leadsKey = `/api/personal/leads${buildQuery({ ...base, from, to, campaign, status: view === "list" ? status : "", q })}`;

  const { data: overview, mutate: mutateOverview, error: overviewError } = useSWR<Overview>(overviewKey, fetcher, { refreshInterval: 15000 });
  const { data: leadsData, mutate: mutateLeads, isLoading } = useSWR<{ leads: PersonalLeadRow[] }>(leadsKey, fetcher, {
    refreshInterval: 15000,
  });

  // Alerta na tela quando um lead particular novo chega com a página aberta.
  const lastSeen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const latest = overview?.latestLead;
    if (latest === undefined) return;
    if (lastSeen.current === undefined) {
      lastSeen.current = latest?.id ?? null;
      return;
    }
    if (latest && latest.id !== lastSeen.current) {
      lastSeen.current = latest.id;
      setToast(`Novo lead particular: ${latest.name}`);
      // Com o push ativo, o som já toca pelo aviso do celular/navegador; senão, toca aqui.
      const pushOn = typeof Notification !== "undefined" && Notification.permission === "granted";
      if (mode === "broker" && !pushOn && !isQuietHours()) playLeadAlertSound();
    }
  }, [overview?.latestLead, mode]);

  function refresh() {
    void mutateOverview();
    void mutateLeads();
  }

  if (overviewError) {
    return (
      <div className="px-4 py-8 sm:px-8">
        <Card className="text-text-secondary">{overviewError.message}</Card>
      </div>
    );
  }

  const kpis = overview?.kpis;
  const connections = overview?.connections ?? [];
  const activeConnections = connections.filter((c) => c.isActive);
  const leads = leadsData?.leads ?? [];

  return (
    <div className="px-4 py-8 sm:px-8">
      {mode === "admin" && (
        <Link href="/settings/area-do-corretor" className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-gold">
          <ArrowLeft size={14} /> Voltar para a Área do Corretor
        </Link>
      )}
      <h1 className="text-2xl font-semibold text-foreground">
        {mode === "admin" ? `Carteira particular — ${brokerName ?? ""}` : "Área do Corretor"}
      </h1>
      <p className="mt-1 text-text-secondary">
        Leads das campanhas particulares {mode === "admin" ? "deste corretor" : "da sua conta Meta"}. Eles não passam pela roleta e
        ficam só nesta carteira.
      </p>

      {toast && (
        <button
          type="button"
          onClick={() => setToast(null)}
          className="mt-4 flex w-full items-center gap-2 rounded-xl border border-[color:var(--color-border-gold-strong)] bg-gold-soft px-4 py-3 text-left text-sm text-foreground"
        >
          <BellRing size={16} className="text-gold" />
          {toast}
        </button>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ["Total recebidos", kpis?.total],
          ["Novos", kpis?.new],
          ["Em atendimento", kpis?.inService],
          ["Qualificados", kpis?.qualified],
          ["Convertidos", kpis?.converted],
          ["Perdidos", kpis?.lost],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardLabel>{label}</CardLabel>
            <CardValue className="text-foreground">{value ?? "—"}</CardValue>
          </Card>
        ))}
      </div>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">Integração Meta</h2>
          {!connecting && (mode === "broker" || brokerId) && (
            <Button variant="secondary" onClick={() => setConnecting(true)}>
              <Plus size={14} />
              {activeConnections.length === 0
                ? mode === "admin"
                  ? "Conectar conta Meta do corretor"
                  : "Conectar minha conta Meta"
                : "Conectar outra Página / reconectar"}
            </Button>
          )}
        </div>
        <div className="mt-3 space-y-3">
          {connecting && (
            <PersonalConnectForm
              brokerId={mode === "admin" ? brokerId : undefined}
              brokerName={brokerName}
              onConnected={() => {
                setConnecting(false);
                refresh();
              }}
              onCancel={() => setConnecting(false)}
            />
          )}
          {connections.map((c) => (
            <ConnectionCard key={c.id} connection={c} canSync onChanged={refresh} />
          ))}
          {overview && connections.length === 0 && !connecting && (
            <Card className="text-sm text-text-secondary">
              {mode === "broker"
                ? "Nenhuma conta conectada ainda. Clique em “Conectar minha conta Meta” para começar a receber os leads das suas campanhas."
                : "Este corretor ainda não tem conta Meta conectada. Você pode conectar por ele em “Conectar conta Meta do corretor” (o acesso à Área do Corretor precisa estar ativado)."}
            </Card>
          )}
        </div>
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">Carteira particular</h2>
          <div className="flex gap-1.5">
            <Button variant={view === "list" ? "primary" : "secondary"} className="py-1.5" onClick={() => setView("list")}>
              <List size={14} /> Lista
            </Button>
            <Button variant={view === "kanban" ? "primary" : "secondary"} className="py-1.5" onClick={() => setView("kanban")}>
              <KanbanIcon size={14} /> Kanban
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome, telefone ou e-mail" />
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até" />
          <select
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            className="w-full rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 px-4 py-2.5 text-sm text-foreground"
          >
            <option value="">Todas as campanhas</option>
            {(overview?.campaigns ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {view === "list" && (
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 px-4 py-2.5 text-sm text-foreground"
            >
              <option value="">Todas as etapas</option>
              {PERSONAL_COLUMNS.map((c) => (
                <option key={c.status} value={c.status}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {isLoading ? (
          <p className="mt-6 text-text-secondary">Carregando...</p>
        ) : view === "kanban" ? (
          <PersonalKanban leads={leads} onChanged={refresh} onOpen={setOpenLead} />
        ) : leads.length === 0 ? (
          <Card className="mt-4 text-center text-text-secondary">Nenhum lead particular encontrado.</Card>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-[color:var(--color-border-gold)]">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Telefone</th>
                  <th className="px-4 py-3">E-mail</th>
                  <th className="px-4 py-3">Campanha</th>
                  <th className="px-4 py-3">Entrada</th>
                  <th className="px-4 py-3">Etapa</th>
                  <th className="px-4 py-3">Origem</th>
                  <th className="px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-t border-[color:var(--color-border-gold)] bg-surface">
                    <td className="px-4 py-3 text-foreground">
                      {l.name}
                      {l.brokerName && <p className="text-xs text-gold">{l.brokerName}</p>}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{l.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-text-secondary">{l.email ?? "—"}</td>
                    <td className="px-4 py-3 text-text-secondary">{l.campaignName ?? "—"}</td>
                    <td className="px-4 py-3 text-text-secondary">{formatBrasilia(l.createdAt, "dd/MM/yyyy HH:mm")}</td>
                    <td className="px-4 py-3">
                      <Badge>{personalStatusLabel(l.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{sourceLabel(l.sourceType)}</td>
                    <td className="px-4 py-3">
                      <Button variant="secondary" className="py-1.5 text-xs" onClick={() => setOpenLead(l.id)}>
                        Abrir{l.noteCount > 0 ? ` · ${l.noteCount} nota(s)` : ""}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {openLead && <PersonalLeadDialog leadId={openLead} onClose={() => setOpenLead(null)} onChanged={refresh} />}
    </div>
  );
}

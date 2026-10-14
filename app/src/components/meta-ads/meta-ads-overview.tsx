"use client";

import { useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { fetcher, poster, deleter } from "@/lib/fetcher";
import { Card, CardLabel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AccountSnapshot, CampaignRow } from "@crm/db";

type Preset = { id: string; label: string };
type OverviewResponse =
  | { connected: false; presets: Preset[] }
  | {
      connected: true;
      preset: string;
      presets: Preset[];
      monitor: {
        adAccountId: string;
        adAccountName: string | null;
        tokenExpiresAt: string | null;
        dataAccessExpiresAt: string | null;
        lastCheckAt: string | null;
        lastError: string | null;
      };
      snapshot: AccountSnapshot | null;
      error?: string;
      fetchedAt?: string;
    };

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
const int = (n: number) => Math.round(n || 0).toLocaleString("pt-BR");
const daysLabel = (d: number) => (d < 1 ? "menos de 1 dia" : `${Math.floor(d)} ${Math.floor(d) === 1 ? "dia" : "dias"}`);
const dateBR = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null);
const timeBR = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : "";

/* cor de cada situação da conta */
const DELIVERY_TONE: Record<AccountSnapshot["delivery"], string> = {
  running: "text-success",
  idle: "text-gold",
  stopped: "text-text-secondary",
  problem: "text-danger",
};
const DELIVERY_DOT: Record<AccountSnapshot["delivery"], string> = {
  running: "bg-success",
  idle: "bg-gold",
  stopped: "bg-text-secondary",
  problem: "bg-danger",
};

export function MetaAdsOverview() {
  const [preset, setPreset] = useState("last_7d");
  const { data, error, isLoading, isValidating, mutate } = useSWR<OverviewResponse>(`/api/meta-ads?preset=${preset}`, fetcher, {
    refreshInterval: 5 * 60 * 1000,
  });

  return (
    <div className="px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Meta Ads</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {data?.connected
              ? `${data.monitor.adAccountName ?? data.monitor.adAccountId}${data.fetchedAt ? ` · atualizado às ${timeBR(data.fetchedAt)}` : ""}`
              : "Saldo, veiculação e leads da conta de anúncio"}
          </p>
        </div>
        {data?.connected && (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 px-3 py-2.5 text-sm text-foreground sm:flex-none"
              title='"Últimos X dias" não inclui hoje'
            >
              {data.presets.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => mutate()} disabled={isValidating}>
              <RefreshCw size={15} className={clsx(isValidating && "animate-spin")} />
              <span className="hidden sm:inline">Atualizar</span>
            </Button>
          </div>
        )}
      </div>

      {isLoading && <p className="mt-10 text-center text-sm text-text-secondary">Puxando dados do Meta...</p>}
      {error && <p className="mt-6 text-sm text-danger">{error.message}</p>}
      {data && !data.connected && <ConnectForm onConnected={() => mutate()} />}
      {data?.connected && (
        <>
          {data.error && (
            <Card className="mt-6 border-danger/40">
              <p className="text-sm font-semibold text-danger">O Meta não respondeu</p>
              <p className="mt-1 text-sm text-text-secondary">{data.error}</p>
            </Card>
          )}
          {data.snapshot && <AccountView snap={data.snapshot} preset={preset} presetLabel={data.presets.find((p) => p.id === preset)?.label ?? ""} />}
          <ConnectionFooter monitor={data.monitor} onChanged={() => mutate()} />
        </>
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string | null; tone?: string }) {
  return (
    <Card className="p-4">
      <CardLabel>{label}</CardLabel>
      <p className={clsx("mt-1.5 text-2xl font-semibold tracking-tight", tone ?? "text-foreground")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-text-secondary">{sub}</p>}
    </Card>
  );
}

function AccountView({ snap, preset, presetLabel }: { snap: AccountSnapshot; preset: string; presetLabel: string }) {
  const [showCamps, setShowCamps] = useState(true);
  const periodShort = presetLabel.replace("Últimos ", "").replace("Último ", "");
  const al = snap.alert;
  const alertTone = !al ? null : al.stopped || al.kind === "low1" ? "danger" : "gold";

  return (
    <>
      {/* situação + alerta */}
      <Card className="mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className={clsx("h-2.5 w-2.5 rounded-full", DELIVERY_DOT[snap.delivery])} />
          <span className={clsx("text-base font-semibold", DELIVERY_TONE[snap.delivery])}>{snap.deliveryLabel}</span>
          <span className="text-sm text-text-secondary">
            {snap.activeCampaigns} de {snap.activeCampaigns + snap.pausedCampaigns} campanhas ativas
          </span>
        </div>
        {al && (
          <div
            className={clsx(
              "mt-4 rounded-xl border px-4 py-3",
              alertTone === "danger" ? "border-danger/40 bg-danger/10" : "border-[color:var(--color-border-gold-strong)] bg-gold-soft"
            )}
          >
            <p className={clsx("text-sm font-semibold", alertTone === "danger" ? "text-danger" : "text-gold")}>{al.title}</p>
            <p className="mt-0.5 text-sm text-foreground">{al.body.split(" · ").slice(1).join(" · ")}</p>
          </div>
        )}
      </Card>

      {/* números principais */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {snap.funds.kind === "prepaid" ? (
          <Metric
            label="Saldo"
            value={brl(snap.funds.balance)}
            tone={snap.funds.balance <= 0 ? "text-danger" : undefined}
            sub={snap.daysLeft != null ? `dura ${daysLabel(snap.daysLeft)} · ${brl(snap.burnRate)}/dia` : snap.burnRate ? `${brl(snap.burnRate)}/dia` : null}
          />
        ) : (
          <Metric label="A pagar" value={brl(snap.funds.owed)} sub={snap.funds.capLeft != null ? `limite ${brl(snap.funds.capLeft)}` : "cartão"} />
        )}
        <Metric label="Gasto hoje" value={brl(snap.today.spend)} sub={snap.dailyBudget > 0 ? `de ${brl(snap.dailyBudget)}/dia` : null} />
        <Metric label="Leads hoje" value={int(snap.today.leads)} tone={snap.today.leads ? "text-gold" : undefined} sub={snap.today.impressions ? `${int(snap.today.impressions)} impressões` : null} />
        <Metric
          label={`Leads · ${periodShort}`}
          value={int(snap.period.leads)}
          sub={snap.period.leads ? `CPL ${brl(snap.period.spend / snap.period.leads)} · ${brl(snap.period.spend)}` : snap.period.spend ? `${brl(snap.period.spend)} gastos` : null}
        />
      </div>

      {/* campanhas */}
      <Card className="mt-4 p-0">
        <button onClick={() => setShowCamps((v) => !v)} className="flex w-full items-center gap-2 px-5 py-4 text-left">
          {showCamps ? <ChevronDown size={16} className="text-text-secondary" /> : <ChevronRight size={16} className="text-text-secondary" />}
          <span className="font-semibold text-foreground">Campanhas</span>
        </button>
        {showCamps && <Campaigns preset={preset} periodShort={periodShort} />}
      </Card>
    </>
  );
}

function Campaigns({ preset, periodShort }: { preset: string; periodShort: string }) {
  const { data, error, isLoading } = useSWR<{ rows: CampaignRow[]; hidden: number }>(`/api/meta-ads/campaigns?preset=${preset}`, fetcher, {
    refreshInterval: 5 * 60 * 1000,
  });
  if (isLoading) return <p className="px-5 pb-4 text-sm text-text-secondary">Carregando campanhas...</p>;
  if (error) return <p className="px-5 pb-4 text-sm text-danger">{error.message}</p>;
  if (!data?.rows.length) return <p className="px-5 pb-4 text-sm text-text-secondary">Nenhuma campanha ativa ou com gasto no período.</p>;

  return (
    <div className="border-t border-[color:var(--color-border-gold)]">
      {data.rows.map((c) => {
        const active = c.status === "ACTIVE";
        const [label, dot] = active ? (c.today.spend > 0 ? ["Veiculando", "bg-success"] : ["Ativa, sem gasto hoje", "bg-gold"]) : ["Pausada", "bg-text-secondary"];
        const budget = c.dailyBudget ? `${brl(c.dailyBudget)}/dia` : c.lifetimeBudget ? `${brl(c.lifetimeBudget)} total` : "orçamento no conjunto";
        return (
          <div key={c.id} className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-[color:var(--color-border-gold)] px-5 py-3.5 last:border-b-0 sm:grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,1fr))]">
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground" title={c.name}>
                <span className={clsx("h-2 w-2 shrink-0 rounded-full", dot)} />
                <span className="truncate">{c.name}</span>
              </p>
              <p className="ml-4 text-xs text-text-secondary">{label} · {budget}</p>
            </div>
            <CampaignStat label="Gasto hoje" value={brl(c.today.spend)} />
            <CampaignStat label="Leads hoje" value={int(c.today.leads)} />
            <CampaignStat label={`Leads · ${periodShort}`} value={int(c.period.leads)} sub={c.period.leads ? `CPL ${brl(c.period.spend / c.period.leads)}` : null} />
          </div>
        );
      })}
      {data.hidden > 0 && <p className="px-5 py-3 text-xs text-text-secondary">{data.hidden} campanha(s) pausada(s) sem gasto no período não mostrada(s).</p>}
    </div>
  );
}

function CampaignStat({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="min-w-0 sm:text-right">
      <p className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
      {sub && <p className="text-xs text-text-secondary">{sub}</p>}
    </div>
  );
}

function ConnectionFooter({ monitor, onChanged }: { monitor: Extract<OverviewResponse, { connected: true }>["monitor"]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const access = dateBR(monitor.dataAccessExpiresAt);
  const expires = dateBR(monitor.tokenExpiresAt);

  const disconnect = async () => {
    if (!confirm("Desconectar a conta de anúncio? Os alertas de saldo param de ser enviados.")) return;
    setBusy(true);
    try { await deleter("/api/meta-ads/connect"); onChanged(); } finally { setBusy(false); }
  };

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
        <span>
          Token {expires ? `vence em ${expires}` : "sem validade"}
          {access && ` · acesso aos dados até ${access}`}
          {monitor.lastCheckAt && ` · verificação automática às ${timeBR(monitor.lastCheckAt)}`}
        </span>
        <span className="flex gap-3">
          <button onClick={() => setEditing((v) => !v)} className="font-medium text-gold">Trocar token</button>
          <button onClick={disconnect} disabled={busy} className="font-medium text-danger">Desconectar</button>
        </span>
      </div>
      {monitor.lastError && <p className="mt-1 text-xs text-danger">Última verificação automática: {monitor.lastError}</p>}
      {editing && <ConnectForm initialAccountId={monitor.adAccountId.replace("act_", "")} onConnected={() => { setEditing(false); onChanged(); }} />}
    </div>
  );
}

function ConnectForm({ initialAccountId = "", onConnected }: { initialAccountId?: string; onConnected: () => void }) {
  const [adAccountId, setAdAccountId] = useState(initialAccountId);
  const [accessToken, setAccessToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await poster("/api/meta-ads/connect", { adAccountId, accessToken });
      setAccessToken("");
      onConnected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6 max-w-xl">
      <CardLabel>Conectar conta de anúncio</CardLabel>
      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs text-text-secondary">ID da conta de anúncio</label>
          <Input value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)} placeholder="1763552198217471" inputMode="numeric" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-secondary">Token do usuário do sistema</label>
          <Textarea value={accessToken} onChange={(e) => setAccessToken(e.target.value)} rows={3} placeholder="EAAG..." className="font-mono text-xs" />
        </div>
        <p className="text-xs leading-relaxed text-text-secondary">
          Na BM do cliente: Configurações do negócio → Usuários do sistema → crie um usuário, atribua a conta de anúncio
          com permissão &quot;Ver desempenho&quot; e gere um token com <span className="text-gold">ads_read</span>, validade &quot;Nunca&quot;.
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button onClick={submit} disabled={busy || !adAccountId.trim() || accessToken.trim().length < 20}>
          {busy ? "Validando no Meta..." : "Conectar"}
        </Button>
      </div>
    </Card>
  );
}

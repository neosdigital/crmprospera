"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { CalendarRange } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { SimpleBarChart } from "@/components/dashboard/simple-bar-chart";
import { BrokerRanking } from "@/components/dashboard/broker-ranking";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { leadStatusLabel } from "@/lib/labels";

type MetricsResponse = {
  kpis: {
    leadsInPeriod: number;
    waiting: number;
    inProgress: number;
    avgResponseMs: number | null;
    responseRate: number | null;
    converted: number;
  };
  brokerRanking: {
    id: string;
    name: string;
    status: string;
    isInRotation: boolean;
    rotationPosition: number;
    totalReceived: number;
    totalExpired: number;
    totalContacted: number;
  }[];
  leadsByCampaign: { campaign: string | null; count: number }[];
  leadsByStatus: { status: string; count: number }[];
  rotation: { nextBroker: string | null };
};

const PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatBR(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function DateRangeFilter({
  active,
  range,
  onApply,
}: {
  active: boolean;
  range: { from: string; to: string } | null;
  onApply: (range: { from: string; to: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range?.from ?? todayISO());
  const [to, setTo] = useState(range?.to ?? todayISO());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant={active ? "primary" : "secondary"}
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1.5 text-xs"
      >
        <CalendarRange size={14} />
        {active && range ? `${formatBR(range.from)} – ${formatBR(range.to)}` : "Filtrar Data"}
      </Button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-[color:var(--color-border-gold)] bg-surface p-4 shadow-lg">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
            Período personalizado
          </p>
          <div className="space-y-2">
            <div>
              <label className="mb-1 block text-xs text-text-secondary">De</label>
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-secondary">Até</label>
              <Input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <Button
            type="button"
            className="mt-3 w-full py-2 text-xs"
            onClick={() => {
              onApply({ from, to });
              setOpen(false);
            }}
          >
            Aplicar
          </Button>
        </div>
      )}
    </div>
  );
}

export function OwnerDashboard() {
  const [period, setPeriod] = useState("today");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);

  const queryString =
    period === "custom" && customRange
      ? `period=custom&from=${customRange.from}&to=${customRange.to}`
      : `period=${period}`;

  const { data, isLoading } = useSWR<MetricsResponse>(`/api/dashboard/metrics?${queryString}`, fetcher, {
    refreshInterval: 10_000,
  });

  return (
    <div className="px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="mt-1 text-text-secondary">Visão geral da operação de leads</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <Button
              key={p.value}
              variant={period === p.value ? "primary" : "secondary"}
              onClick={() => setPeriod(p.value)}
              className="px-3 py-1.5 text-xs"
            >
              {p.label}
            </Button>
          ))}
          <DateRangeFilter
            active={period === "custom"}
            range={customRange}
            onApply={(range) => {
              setCustomRange(range);
              setPeriod("custom");
            }}
          />
        </div>
      </div>

      {isLoading || !data ? (
        <p className="text-text-secondary">Carregando métricas...</p>
      ) : (
        <div className="space-y-6">
          <KpiCards kpis={data.kpis} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SimpleBarChart
              title="Leads por campanha"
              data={data.leadsByCampaign.map((c) => ({ name: c.campaign ?? "Sem campanha", count: c.count }))}
            />
            <SimpleBarChart
              title="Leads por status"
              data={data.leadsByStatus.map((s) => ({ name: leadStatusLabel(s.status), count: s.count }))}
            />
          </div>

          <BrokerRanking brokers={data.brokerRanking} nextBroker={data.rotation.nextBroker} />
        </div>
      )}
    </div>
  );
}

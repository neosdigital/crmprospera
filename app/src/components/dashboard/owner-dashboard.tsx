"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { SimpleBarChart } from "@/components/dashboard/simple-bar-chart";
import { BrokerRanking } from "@/components/dashboard/broker-ranking";
import { Button } from "@/components/ui/button";
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
  rotation: { currentPosition: number | null; nextBroker: string | null };
};

const PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
];

export function OwnerDashboard() {
  const [period, setPeriod] = useState("today");
  const { data, isLoading } = useSWR<MetricsResponse>(`/api/dashboard/metrics?period=${period}`, fetcher, {
    refreshInterval: 10_000,
  });

  return (
    <div className="px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="mt-1 text-text-secondary">Visão geral da operação de leads</p>
        </div>
        <div className="flex gap-2">
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

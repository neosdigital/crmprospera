import { Card, CardLabel, CardValue } from "@/components/ui/card";

function formatMs(ms: number | null) {
  if (ms === null) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function formatPct(v: number | null) {
  if (v === null) return "—";
  return `${Math.round(v * 100)}%`;
}

export function KpiCards({
  kpis,
}: {
  kpis: {
    leadsInPeriod: number;
    waiting: number;
    inProgress: number;
    avgResponseMs: number | null;
    responseRate: number | null;
    converted: number;
  };
}) {
  const items = [
    { label: "Leads no período", value: kpis.leadsInPeriod },
    { label: "Aguardando atendimento", value: kpis.waiting },
    { label: "Em atendimento", value: kpis.inProgress },
    { label: "Tempo médio de resposta", value: formatMs(kpis.avgResponseMs) },
    { label: "Taxa de 1º contato", value: formatPct(kpis.responseRate) },
    { label: "Convertidos", value: kpis.converted },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => (
        <Card key={item.label}>
          <CardLabel>{item.label}</CardLabel>
          <CardValue>{item.value}</CardValue>
        </Card>
      ))}
    </div>
  );
}

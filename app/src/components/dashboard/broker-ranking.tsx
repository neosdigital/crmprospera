import { Card, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type BrokerRow = {
  id: string;
  name: string;
  status: string;
  isInRotation: boolean;
  rotationPosition: number;
  totalReceived: number;
  totalExpired: number;
  totalContacted: number;
};

export function BrokerRanking({ brokers, nextBroker }: { brokers: BrokerRow[]; nextBroker: string | null }) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <CardLabel>Ranking de corretores</CardLabel>
        {nextBroker && (
          <span className="text-xs text-text-secondary">
            Próximo da fila: <span className="font-medium text-gold">{nextBroker}</span>
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border-gold)] text-left text-xs uppercase text-text-secondary">
              <th className="py-2 pr-4">Corretor</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Recebidos</th>
              <th className="py-2 pr-4">Atendidos</th>
              <th className="py-2 pr-4">Expirados</th>
              <th className="py-2 pr-4">Taxa de resposta</th>
            </tr>
          </thead>
          <tbody>
            {brokers.map((b) => (
              <tr key={b.id} className="border-b border-[color:var(--color-border-gold)]/40 last:border-0">
                <td className="py-2.5 pr-4 font-medium text-foreground">
                  {b.name} <span className="text-text-secondary">#{b.rotationPosition}</span>
                </td>
                <td className="py-2.5 pr-4">
                  <Badge tone={b.status === "ACTIVE" && b.isInRotation ? "success" : "neutral"}>
                    {b.status === "ACTIVE" && b.isInRotation ? "ATIVO" : b.status === "PAUSED" ? "PAUSADO" : "INATIVO"}
                  </Badge>
                </td>
                <td className="py-2.5 pr-4">{b.totalReceived}</td>
                <td className="py-2.5 pr-4">{b.totalContacted}</td>
                <td className="py-2.5 pr-4">{b.totalExpired}</td>
                <td className="py-2.5 pr-4">
                  {b.totalReceived > 0 ? `${Math.round((b.totalContacted / b.totalReceived) * 100)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

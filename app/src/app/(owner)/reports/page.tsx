import Link from "next/link";
import { Card, CardLabel } from "@/components/ui/card";

export default function ReportsPage() {
  return (
    <div className="px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Relatórios</h1>
      <p className="mt-1 text-text-secondary">
        Os indicadores completos (leads por corretor, campanha, tempo de resposta, taxa de
        conversão) estão no <Link href="/dashboard" className="text-gold underline">Dashboard</Link>,
        com seletor de período. Aqui você exporta os dados brutos em CSV.
      </p>

      <Card className="mt-6 max-w-lg">
        <CardLabel>Exportar leads (CSV)</CardLabel>
        <p className="mt-2 text-sm text-text-secondary">
          O arquivo respeita os filtros que você aplicar na URL (status, corretor, período). Da
          tela de Leads, use os filtros e depois clique em exportar.
        </p>
        <Link
          href="/api/leads/export"
          className="mt-4 inline-flex rounded-xl bg-gold px-4 py-2.5 text-sm font-semibold text-[#191919]"
        >
          Exportar todos os leads
        </Link>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { scopedDb } from "@/lib/tenant-db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { leadStatusLabel } from "@/lib/labels";

const STATUS_TONE: Record<string, "neutral" | "gold" | "success" | "danger"> = {
  NEW: "neutral",
  WAITING_ASSIGNMENT: "neutral",
  ASSIGNED: "gold",
  CONTACTED: "gold",
  IN_PROGRESS: "success",
  QUALIFIED: "success",
  SCHEDULED: "success",
  CONVERTED: "success",
  LOST: "danger",
  EXPIRED: "danger",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { search, status } = await searchParams;
  const db = scopedDb(session.user.organizationId);

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const leads = await db.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { currentBroker: { select: { displayName: true } } },
  });

  return (
    <div className="px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Leads</h1>
      <p className="mt-1 text-text-secondary">Todos os leads recebidos pela organização.</p>

      <form className="mt-6 flex flex-col gap-3 sm:flex-row" method="get">
        <Input name="search" placeholder="Buscar por nome, telefone ou email" defaultValue={search} className="sm:max-w-xs" />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 px-4 py-2.5 text-sm text-foreground"
        >
          <option value="">Todos os status</option>
          {Object.keys(STATUS_TONE).map((s) => (
            <option key={s} value={s}>
              {leadStatusLabel(s)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-xl bg-gold px-4 py-2.5 text-sm font-semibold text-[#191919]"
        >
          Filtrar
        </button>
        <Link
          href={`/api/leads/export${status ? `?status=${status}` : ""}`}
          className="rounded-xl border border-[color:var(--color-border-gold)] px-4 py-2.5 text-sm text-foreground"
        >
          Exportar CSV
        </Link>
      </form>

      <Card className="mt-6 overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border-gold)] text-left text-xs uppercase text-text-secondary">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Telefone</th>
              <th className="px-4 py-3">Campanha</th>
              <th className="px-4 py-3">Corretor</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Recebido em</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="border-b border-[color:var(--color-border-gold)]/40 last:border-0 hover:bg-surface-2">
                <td className="px-4 py-3">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-foreground hover:text-gold">
                    {lead.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-text-secondary">{lead.phone ?? "—"}</td>
                <td className="px-4 py-3 text-text-secondary">{lead.campaignName ?? "—"}</td>
                <td className="px-4 py-3 text-text-secondary">{lead.currentBroker?.displayName ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge tone={STATUS_TONE[lead.status] ?? "neutral"}>{leadStatusLabel(lead.status)}</Badge>
                </td>
                <td className="px-4 py-3 text-text-secondary">{format(lead.createdAt, "dd/MM HH:mm")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 && (
          <p className="px-4 py-10 text-center text-text-secondary">Nenhum lead encontrado com esses filtros.</p>
        )}
      </Card>
    </div>
  );
}

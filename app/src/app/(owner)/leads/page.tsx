import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { scopedDb } from "@/lib/tenant-db";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { leadStatusLabel } from "@/lib/labels";
import { SendTestLeadButton } from "@/components/leads/send-test-lead-button";
import { LeadsTable, type LeadRow } from "@/components/leads/leads-table";

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

  const rows: LeadRow[] = leads.map((lead) => ({
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    campaignName: lead.campaignName,
    brokerName: lead.currentBroker?.displayName ?? null,
    status: lead.status,
    statusLabel: leadStatusLabel(lead.status),
    statusTone: STATUS_TONE[lead.status] ?? "neutral",
    createdAtLabel: format(lead.createdAt, "dd/MM HH:mm"),
  }));

  return (
    <div className="px-4 py-8 sm:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Leads</h1>
          <p className="mt-1 text-text-secondary">Todos os leads recebidos pela organização.</p>
        </div>
        <SendTestLeadButton />
      </div>

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

      <Card className="mt-6 p-0">
        <LeadsTable leads={rows} />
      </Card>
    </div>
  );
}

import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { scopedDb } from "@/lib/tenant-db";
import { Card, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

const AUDIT_LABEL: Record<string, string> = {
  LEAD_RECEIVED: "Lead recebido",
  ASSIGNED: "Atribuído a um corretor",
  EXPIRED: "Tentativa expirou",
  CONTACTED: "Corretor entrou em contato",
  TRANSFERRED: "Lead transferido",
  STATUS_CHANGED: "Status alterado",
  CONVERTED: "Lead convertido",
  LOST: "Lead perdido",
};

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const db = scopedDb(session.user.organizationId);

  const lead = await db.lead.findUnique({
    where: { id },
    include: {
      currentBroker: { select: { displayName: true, phone: true } },
      assignments: {
        orderBy: { attemptNumber: "asc" },
        include: { broker: { select: { displayName: true } } },
      },
      auditLogs: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!lead) notFound();

  return (
    <div className="px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold uppercase tracking-wide text-foreground">{lead.name}</h1>
      <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-text-secondary">
        {lead.phone && <span>{lead.phone}</span>}
        {lead.email && <span>{lead.email}</span>}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardLabel>Informações</CardLabel>
          <div className="mt-3 space-y-2 text-sm">
            <p>
              <span className="text-text-secondary">Campanha: </span>
              {lead.campaignName ?? "—"}
            </p>
            <p>
              <span className="text-text-secondary">Conjunto: </span>
              {lead.adsetName ?? "—"}
            </p>
            <p>
              <span className="text-text-secondary">Anúncio: </span>
              {lead.adName ?? "—"}
            </p>
            <p>
              <span className="text-text-secondary">Formulário: </span>
              {lead.formName ?? "—"}
            </p>
            <p>
              <span className="text-text-secondary">Origem: </span>
              {lead.source}
            </p>
          </div>

          {lead.customFields && Object.keys(lead.customFields as object).length > 0 && (
            <div className="mt-4 space-y-1.5 border-t border-[color:var(--color-border-gold)] pt-4">
              {Object.entries(lead.customFields as Record<string, unknown>).map(([q, a]) => (
                <p key={q} className="text-sm">
                  <span className="text-text-secondary">{q}: </span>
                  {String(a)}
                </p>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardLabel>Situação atual</CardLabel>
          <div className="mt-3 space-y-2 text-sm">
            <Badge tone="gold">{lead.status}</Badge>
            <p>
              <span className="text-text-secondary">Corretor atual: </span>
              {lead.currentBroker?.displayName ?? "—"}
            </p>
            <p>
              <span className="text-text-secondary">Tentativas: </span>
              {lead.assignments.length}
            </p>
          </div>

          <div className="mt-4 space-y-2 border-t border-[color:var(--color-border-gold)] pt-4">
            {lead.assignments.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm">
                <span>
                  #{a.attemptNumber} {a.broker.displayName}
                </span>
                <Badge tone={a.status === "CONTACTED" ? "success" : a.status === "EXPIRED" ? "danger" : "gold"}>
                  {a.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardLabel>Timeline</CardLabel>
          <ol className="mt-3 space-y-3 border-l border-[color:var(--color-border-gold)] pl-4">
            {lead.auditLogs.map((log) => (
              <li key={log.id} className="text-sm">
                <p className="text-xs text-text-secondary">{format(log.createdAt, "dd/MM HH:mm:ss")}</p>
                <p className="text-foreground">{AUDIT_LABEL[log.action] ?? log.action}</p>
              </li>
            ))}
            {lead.auditLogs.length === 0 && <li className="text-sm text-text-secondary">Sem eventos.</li>}
          </ol>
        </Card>
      </div>
    </div>
  );
}

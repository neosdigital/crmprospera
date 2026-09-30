import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { scopedDb } from "@/lib/tenant-db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { assignmentStatusLabel } from "@/lib/labels";
import { applyLeadContactPrivacy } from "@/lib/lead-privacy";
import { ProtectedContact } from "@/components/leads/protected-contact";

const STATUS_TONE: Record<string, "neutral" | "gold" | "success" | "danger"> = {
  CONTACTED: "success",
  EXPIRED: "danger",
  TRANSFERRED: "neutral",
  ASSIGNED: "gold",
};

export default async function BrokerHistoryPage() {
  const session = await auth();
  if (!session?.user?.brokerId) redirect("/login");

  const db = scopedDb(session.user.organizationId);
  const assignments = await db.leadAssignment.findMany({
    where: { brokerId: session.user.brokerId },
    orderBy: { assignedAt: "desc" },
    take: 50,
    include: { lead: { select: { name: true, phone: true, email: true, currentBrokerId: true } } },
  });
  // Página renderizada no servidor: leads que hoje estão com outro corretor já saem com o
  // contato mascarado no HTML (ver lead-privacy.ts).
  const viewer = { role: session.user.role, brokerId: session.user.brokerId };
  const rows = assignments.map((a) => ({ ...a, lead: applyLeadContactPrivacy(viewer, a.lead) }));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-foreground">Histórico de atendimentos</h1>
      <p className="mt-1 text-text-secondary">Todas as tentativas de atendimento atribuídas a você.</p>

      <div className="mt-6 space-y-3">
        {assignments.length === 0 && (
          <Card className="text-center text-text-secondary">Nenhum atendimento registrado ainda.</Card>
        )}
        {rows.map((a) => (
          <Card key={a.id} className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">{a.lead.name}</p>
              <p className="text-sm text-text-secondary">
                <ProtectedContact value={a.lead.phone} isProtected={a.lead.contactProtected} /> · tentativa{" "}
                {a.attemptNumber} · {formatDistanceToNow(a.assignedAt, { addSuffix: true, locale: ptBR })}
              </p>
              {a.lead.email && (
                <p className="text-sm text-text-secondary">
                  <ProtectedContact value={a.lead.email} isProtected={a.lead.contactProtected} />
                </p>
              )}
            </div>
            <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{assignmentStatusLabel(a.status)}</Badge>
          </Card>
        ))}
      </div>
    </div>
  );
}

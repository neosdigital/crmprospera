import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { scopedDb } from "@/lib/tenant-db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { assignmentStatusLabel } from "@/lib/labels";

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
    include: { lead: { select: { name: true, phone: true, email: true } } },
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-foreground">Histórico de atendimentos</h1>
      <p className="mt-1 text-text-secondary">Todas as tentativas de atendimento atribuídas a você.</p>

      <div className="mt-6 space-y-3">
        {assignments.length === 0 && (
          <Card className="text-center text-text-secondary">Nenhum atendimento registrado ainda.</Card>
        )}
        {assignments.map((a) => (
          <Card key={a.id} className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">{a.lead.name}</p>
              <p className="text-sm text-text-secondary">
                {a.lead.phone} · tentativa {a.attemptNumber} ·{" "}
                {formatDistanceToNow(a.assignedAt, { addSuffix: true, locale: ptBR })}
              </p>
              {a.lead.email && <p className="text-sm text-text-secondary">{a.lead.email}</p>}
            </div>
            <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{assignmentStatusLabel(a.status)}</Badge>
          </Card>
        ))}
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { scopedDb } from "@/lib/tenant-db";
import { OwnerKanban } from "@/components/leads/owner-kanban";

export default async function OwnerKanbanPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const db = scopedDb(session.user.organizationId);
  const brokers = await db.broker.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true },
  });

  return <OwnerKanban brokers={brokers} />;
}

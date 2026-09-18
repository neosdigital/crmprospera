import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { scopedDb } from "@/lib/tenant-db";
import { Card } from "@/components/ui/card";
import { ProfileSoundToggle } from "@/components/broker/profile-sound-toggle";

export default async function BrokerProfilePage() {
  const session = await auth();
  if (!session?.user?.brokerId) redirect("/login");

  const db = scopedDb(session.user.organizationId);
  const broker = await db.broker.findUniqueOrThrow({
    where: { id: session.user.brokerId },
    include: { user: { select: { name: true, email: true } } },
  });

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8">
      <h1 className="text-2xl font-semibold text-foreground">Meu perfil</h1>

      <Card className="mt-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-secondary">Nome</p>
          <p className="text-foreground">{broker.user.name}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-text-secondary">Email</p>
          <p className="text-foreground">{broker.user.email}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-text-secondary">Telefone</p>
          <p className="text-foreground">{broker.phone ?? "—"}</p>
        </div>
        <ProfileSoundToggle initialValue={broker.soundEnabled} />
      </Card>
    </div>
  );
}

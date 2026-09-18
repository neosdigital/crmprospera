import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@crm/db";
import { OrgSettingsForm } from "@/components/settings/org-settings-form";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: session.user.organizationId } });

  return (
    <div className="px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Configurações</h1>
      <p className="mt-1 text-text-secondary">Preferências gerais da organização.</p>
      <div className="mt-6">
        <OrgSettingsForm initialName={org.name} initialTimeout={org.responseTimeoutMinutes} />
      </div>
    </div>
  );
}

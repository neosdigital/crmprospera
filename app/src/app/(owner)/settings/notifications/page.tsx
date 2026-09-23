import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PushNotificationSettings } from "@/components/settings/push-notification-settings";

export default async function NotificationsSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Notificações push</h1>
      <p className="mt-1 text-text-secondary">
        Receba um aviso mesmo com o CRM fechado sempre que um lead novo chegar — no computador
        e no celular.
      </p>
      <div className="mt-6 max-w-2xl">
        <PushNotificationSettings isAdmin={session.user.role === "OWNER" || session.user.role === "ADMIN"} />
      </div>
    </div>
  );
}

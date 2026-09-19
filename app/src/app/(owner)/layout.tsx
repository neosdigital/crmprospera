import { redirect } from "next/navigation";
import { LayoutDashboard, Users2, RefreshCw, BarChart3, Plug, Settings, Radio, ListChecks } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@crm/db";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { SignOutButton } from "@/components/layout/sign-out-button";

const ICON_SIZE = 18;

const ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={ICON_SIZE} /> },
  { href: "/leads", label: "Leads", icon: <ListChecks size={ICON_SIZE} /> },
  { href: "/live", label: "Ao Vivo", icon: <Radio size={ICON_SIZE} /> },
  { href: "/settings/rotation", label: "Roleta", icon: <RefreshCw size={ICON_SIZE} /> },
  { href: "/settings/brokers", label: "Corretores", icon: <Users2 size={ICON_SIZE} /> },
  { href: "/reports", label: "Relatórios", icon: <BarChart3 size={ICON_SIZE} /> },
  { href: "/settings/integrations", label: "Integrações", icon: <Plug size={ICON_SIZE} /> },
  { href: "/settings", label: "Configurações", icon: <Settings size={ICON_SIZE} /> },
];

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId } });

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <MobileNav
        items={ITEMS}
        orgName={org?.name ?? ""}
        userName={session.user.name ?? ""}
        signOutSlot={<SignOutButton />}
      />
      <Sidebar items={ITEMS} orgName={org?.name ?? ""} userName={session.user.name ?? ""} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

import { redirect } from "next/navigation";
import { LayoutDashboard, Users2, RefreshCw, BarChart3, Plug, Settings, Radio, ListChecks } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@crm/db";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";

const ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: ListChecks },
  { href: "/live", label: "Ao Vivo", icon: Radio },
  { href: "/settings/rotation", label: "Roleta", icon: RefreshCw },
  { href: "/settings/brokers", label: "Corretores", icon: Users2 },
  { href: "/reports", label: "Relatórios", icon: BarChart3 },
  { href: "/settings/integrations/meta", label: "Integrações", icon: Plug },
  { href: "/settings", label: "Configurações", icon: Settings },
];

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId } });

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <MobileNav items={ITEMS} orgName={org?.name ?? ""} />
      <Sidebar items={ITEMS} orgName={org?.name ?? ""} userName={session.user.name ?? ""} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

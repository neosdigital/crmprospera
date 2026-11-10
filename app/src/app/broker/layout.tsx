import { redirect } from "next/navigation";
import { LayoutDashboard, History, User, Kanban, Radio, Briefcase } from "lucide-react";
import { brokerHasPersonalAreaSafe } from "@/lib/personal-area";
import { auth } from "@/auth";
import { prisma } from "@crm/db";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { BrokerAlertListener } from "@/components/notifications/broker-alert-listener";

const ICON_SIZE = 18;

const ITEMS = [
  { href: "/broker/dashboard", label: "Dashboard", icon: <LayoutDashboard size={ICON_SIZE} /> },
  { href: "/broker/wallet", label: "Minha Carteira", icon: <Kanban size={ICON_SIZE} /> },
  { href: "/broker/live", label: "Ao Vivo", icon: <Radio size={ICON_SIZE} /> },
  { href: "/broker/history", label: "Histórico", icon: <History size={ICON_SIZE} /> },
  { href: "/broker/profile", label: "Meu Perfil", icon: <User size={ICON_SIZE} /> },
];

const PERSONAL_AREA_ITEM = { href: "/broker/area-particular", label: "Área do Corretor", icon: <Briefcase size={ICON_SIZE} /> };

export default async function BrokerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const org = await prisma.organization.findUnique({ where: { id: session.user.organizationId } });

  // Área do Corretor: item extra só para quem tem o acesso liberado. Nunca lança — se a tabela
  // ainda não existir no banco, o menu fica exatamente como antes.
  const items = (await brokerHasPersonalAreaSafe(session.user.brokerId))
    ? [...ITEMS.slice(0, 2), PERSONAL_AREA_ITEM, ...ITEMS.slice(2)]
    : ITEMS;

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <MobileNav
        items={items}
        orgName={org?.name ?? ""}
        userName={session.user.name ?? ""}
        signOutSlot={<SignOutButton />}
      />
      <Sidebar items={items} orgName={org?.name ?? ""} userName={session.user.name ?? ""} />
      <main className="flex-1 overflow-y-auto">{children}</main>
      <BrokerAlertListener />
    </div>
  );
}

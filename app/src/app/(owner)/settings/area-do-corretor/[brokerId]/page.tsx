import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@crm/db";
import { PersonalAreaView } from "@/components/personal-area/personal-area-view";

/** Dono/Admin: carteira particular de um corretor da própria imobiliária. */
export default async function PersonalAreaBrokerPage({ params }: { params: Promise<{ brokerId: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "OWNER" && session.user.role !== "ADMIN") redirect("/broker/dashboard");

  const { brokerId } = await params;
  const broker = await prisma.broker.findFirst({
    where: { id: brokerId, organizationId: session.user.organizationId },
    select: { id: true, displayName: true },
  });
  if (!broker) notFound();

  return <PersonalAreaView mode="admin" brokerId={broker.id} brokerName={broker.displayName} />;
}

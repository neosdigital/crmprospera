import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { BrokerDashboard } from "@/components/broker/broker-dashboard";

export default async function BrokerDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const firstName = (session.user.name ?? "Corretor").split(" ")[0];

  return <BrokerDashboard brokerFirstName={firstName} />;
}

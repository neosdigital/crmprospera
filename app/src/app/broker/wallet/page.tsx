import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { BrokerKanban } from "@/components/broker/broker-kanban";

export default async function BrokerWalletPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <BrokerKanban />;
}

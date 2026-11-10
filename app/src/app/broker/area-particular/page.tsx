import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { brokerHasPersonalAreaSafe } from "@/lib/personal-area";
import { PersonalAreaView } from "@/components/personal-area/personal-area-view";

/** Área do Corretor: só abre para corretor com o acesso liberado (conferido no servidor). */
export default async function BrokerPersonalAreaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "BROKER" || !(await brokerHasPersonalAreaSafe(session.user.brokerId))) {
    redirect("/broker/dashboard");
  }
  return <PersonalAreaView mode="broker" />;
}

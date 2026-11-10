import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PersonalAdmin } from "@/components/personal-area/personal-admin";

export default async function PersonalAreaAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "OWNER" && session.user.role !== "ADMIN") redirect("/broker/dashboard");
  return <PersonalAdmin />;
}

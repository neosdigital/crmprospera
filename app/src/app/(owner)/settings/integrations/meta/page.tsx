import { headers } from "next/headers";
import { MetaIntegrationSettings } from "@/components/settings/meta-integration";

export default async function MetaIntegrationPage() {
  const h = await headers();
  const host = h.get("host");
  const protocol = host?.startsWith("localhost") ? "http" : "https";
  const webhookUrl = `${protocol}://${host}/api/webhooks/meta`;

  return (
    <div className="px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Integração com Meta Ads</h1>
      <p className="mt-1 text-text-secondary">Conecte a página do Facebook para receber leads automaticamente.</p>
      <div className="mt-6 max-w-2xl">
        <MetaIntegrationSettings webhookUrl={webhookUrl} />
      </div>
    </div>
  );
}

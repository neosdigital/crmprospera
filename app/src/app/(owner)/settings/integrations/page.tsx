import Link from "next/link";
import { Plug, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/card";

const INTEGRATIONS = [
  {
    href: "/settings/integrations/meta",
    icon: Plug,
    title: "Meta Ads (Leads)",
    description: "Receba automaticamente os leads dos formulários do Facebook/Instagram Ads.",
  },
  {
    href: "/settings/integrations/whatsapp",
    icon: MessageCircle,
    title: "WhatsApp",
    description: "Avise os corretores no WhatsApp quando um lead chegar ou o prazo esgotar.",
  },
];

export default function IntegrationsHubPage() {
  return (
    <div className="px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Integrações</h1>
      <p className="mt-1 text-text-secondary">Conecte serviços externos ao CRM.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {INTEGRATIONS.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="h-full transition-colors hover:border-[color:var(--color-border-gold-strong)]">
              <item.icon className="text-gold" size={22} />
              <p className="mt-3 font-medium text-foreground">{item.title}</p>
              <p className="mt-1 text-sm text-text-secondary">{item.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

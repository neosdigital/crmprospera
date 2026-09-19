import { WhatsAppIntegrationSettings } from "@/components/settings/whatsapp-integration";

export default function WhatsAppIntegrationPage() {
  return (
    <div className="px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Integração com WhatsApp</h1>
      <p className="mt-1 text-text-secondary">
        Avise os corretores automaticamente no WhatsApp quando um lead chegar e quando o prazo
        esgotar sem resposta.
      </p>
      <div className="mt-6 max-w-2xl">
        <WhatsAppIntegrationSettings />
      </div>
    </div>
  );
}

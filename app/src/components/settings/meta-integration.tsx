"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, poster, FetchError } from "@/lib/fetcher";
import { Card, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

type Integration = {
  id: string;
  pageId: string;
  pageName: string | null;
  isActive: boolean;
  lastEventAt: string | null;
  lastLeadSyncAt: string | null;
  webhookVerifiedAt: string | null;
};

function fmt(date: string | null) {
  return date ? format(new Date(date), "dd/MM/yyyy HH:mm") : "—";
}

export function MetaIntegrationSettings({ webhookUrl }: { webhookUrl: string }) {
  const { data, mutate, isLoading } = useSWR<{ integrations: Integration[] }>("/api/integrations/meta", fetcher);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  async function connect(formData: FormData) {
    setConnecting(true);
    setError(null);
    try {
      await poster("/api/integrations/meta/connect", {
        pageId: formData.get("pageId"),
        pageAccessToken: formData.get("pageAccessToken"),
      });
      mutate();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : "Não foi possível conectar.");
    } finally {
      setConnecting(false);
    }
  }

  async function test(id: string) {
    setTestResult((s) => ({ ...s, [id]: "Testando..." }));
    try {
      const result = await poster<{ ok: boolean; pageName?: string; error?: string }>("/api/integrations/meta/test", {
        integrationId: id,
      });
      setTestResult((s) => ({ ...s, [id]: result.ok ? `OK — ${result.pageName}` : `Falhou: ${result.error}` }));
    } catch (err) {
      setTestResult((s) => ({ ...s, [id]: err instanceof FetchError ? err.message : "Falha no teste" }));
    }
  }

  async function disconnect(id: string) {
    await poster("/api/integrations/meta/disconnect", { integrationId: id });
    mutate();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardLabel>Webhook</CardLabel>
        <p className="mt-2 text-sm text-text-secondary">
          Configure esta URL no painel do seu app em{" "}
          <span className="text-foreground">developers.facebook.com → Webhooks → Página → leadgen</span>:
        </p>
        <code className="mt-2 block break-all rounded-lg bg-surface-2 px-3 py-2 text-xs text-gold">{webhookUrl}</code>
        <p className="mt-2 text-xs text-text-secondary">
          Verify Token: use o valor da variável <code>META_VERIFY_TOKEN</code> do seu ambiente.
        </p>
      </Card>

      {data?.integrations.map((integration) => (
        <Card key={integration.id}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">{integration.pageName ?? integration.pageId}</p>
              <p className="text-xs text-text-secondary">ID: {integration.pageId}</p>
            </div>
            <Badge tone={integration.isActive ? "success" : "neutral"}>
              {integration.isActive ? "● Conectado" : "Desconectado"}
            </Badge>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <p>
              <span className="text-text-secondary">Último evento: </span>
              {fmt(integration.lastEventAt)}
            </p>
            <p>
              <span className="text-text-secondary">Último lead: </span>
              {fmt(integration.lastLeadSyncAt)}
            </p>
            <p>
              <span className="text-text-secondary">Webhook verificado: </span>
              {fmt(integration.webhookVerifiedAt)}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" className="text-xs" onClick={() => test(integration.id)}>
              Testar conexão
            </Button>
            <Button variant="danger" className="text-xs" onClick={() => disconnect(integration.id)}>
              Desconectar
            </Button>
          </div>
          {testResult[integration.id] && (
            <p className="mt-2 text-xs text-text-secondary">{testResult[integration.id]}</p>
          )}
        </Card>
      ))}

      {!isLoading && data?.integrations.length === 0 && (
        <Card className="text-center text-text-secondary">Nenhuma página conectada ainda.</Card>
      )}

      <Card>
        <CardLabel>Conectar / reautenticar página</CardLabel>
        <form action={connect} className="mt-3 space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Page ID</label>
            <Input name="pageId" required placeholder="123456789" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">
              Token de acesso da página (long-lived)
            </label>
            <Input name="pageAccessToken" required placeholder="EAAB..." type="password" />
          </div>
          <Button type="submit" disabled={connecting}>
            {connecting ? "Conectando..." : "Conectar"}
          </Button>
          {error && <p className="text-sm text-danger">{error}</p>}
        </form>
        <p className="mt-3 text-xs text-text-secondary">
          Veja no README o passo a passo completo de como criar o app no Meta for Developers e
          gerar esse token.
        </p>
      </Card>
    </div>
  );
}

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
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  isActive: boolean;
  lastMessageAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
};

type Template = { name: string; category: string; language: string; body: string };

function fmt(date: string | null) {
  return date ? format(new Date(date), "dd/MM/yyyy HH:mm") : "—";
}

export function WhatsAppIntegrationSettings() {
  const { data, mutate, isLoading } = useSWR<{ integration: Integration | null; templates: Record<string, Template> }>(
    "/api/integrations/whatsapp",
    fetcher
  );
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function connect(formData: FormData) {
    setConnecting(true);
    setError(null);
    try {
      await poster("/api/integrations/whatsapp/connect", {
        phoneNumberId: formData.get("phoneNumberId"),
        accessToken: formData.get("accessToken"),
      });
      mutate();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : "Não foi possível conectar.");
    } finally {
      setConnecting(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await poster<{ ok: boolean; error?: string }>("/api/integrations/whatsapp/test", { to: testPhone });
      setTestResult(result.ok ? "Mensagem de teste enviada." : `Falhou: ${result.error}`);
    } catch (err) {
      setTestResult(err instanceof FetchError ? err.message : "Falha no teste.");
    } finally {
      setTesting(false);
    }
  }

  async function disconnect() {
    await poster("/api/integrations/whatsapp/disconnect");
    mutate();
  }

  const integration = data?.integration;
  const templates = data?.templates;

  return (
    <div className="space-y-6">
      <Card>
        <CardLabel>Antes de conectar</CardLabel>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm text-text-secondary">
          <li>No mesmo app da Meta usado para os Leads, adicione o produto <span className="text-foreground">WhatsApp</span>.</li>
          <li>Cadastre/verifique um número de telefone da empresa (não pode ser um número já usado no app pessoal do WhatsApp).</li>
          <li>Gere um token de acesso com a permissão <code className="text-gold">whatsapp_business_messaging</code>.</li>
          <li>
            Em <span className="text-foreground">WhatsApp Manager → Modelos de mensagem</span>, crie os dois templates
            abaixo (categoria Utilidade) e aguarde a aprovação da Meta antes de usar.
          </li>
        </ol>
      </Card>

      {templates && (
        <Card>
          <CardLabel>Templates a criar e aprovar</CardLabel>
          <div className="mt-3 space-y-4">
            {Object.values(templates).map((t) => (
              <div key={t.name} className="rounded-lg border border-[color:var(--color-border-gold)]/40 p-3">
                <p className="text-xs text-text-secondary">
                  Nome: <code className="text-gold">{t.name}</code> · Categoria: {t.category} · Idioma: {t.language}
                </p>
                <p className="mt-1.5 text-sm text-foreground">{t.body}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {isLoading && <p className="text-text-secondary">Carregando...</p>}

      {integration ? (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">{integration.displayPhoneNumber ?? integration.phoneNumberId}</p>
              <p className="text-xs text-text-secondary">Phone Number ID: {integration.phoneNumberId}</p>
            </div>
            <Badge tone={integration.isActive ? "success" : "neutral"}>
              {integration.isActive ? "● Conectado" : "Desconectado"}
            </Badge>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <p>
              <span className="text-text-secondary">Última mensagem enviada: </span>
              {fmt(integration.lastMessageAt)}
            </p>
            <p>
              <span className="text-text-secondary">Último erro: </span>
              {integration.lastError ? `${integration.lastError} (${fmt(integration.lastErrorAt)})` : "—"}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[180px]">
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">Testar com um número</label>
              <Input placeholder="+5547999998888" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
            </div>
            <Button variant="secondary" className="text-xs" disabled={testing || !testPhone} onClick={sendTest}>
              {testing ? "Enviando..." : "Enviar teste"}
            </Button>
            <Button variant="danger" className="text-xs" onClick={disconnect}>
              Desconectar
            </Button>
          </div>
          {testResult && <p className="mt-2 text-xs text-text-secondary">{testResult}</p>}
        </Card>
      ) : (
        !isLoading && (
          <Card>
            <CardLabel>Conectar número de WhatsApp</CardLabel>
            <form action={connect} className="mt-3 space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">Phone Number ID</label>
                <Input name="phoneNumberId" required placeholder="123456789012345" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">Token de acesso</label>
                <Input name="accessToken" required placeholder="EAAB..." type="password" />
              </div>
              <Button type="submit" disabled={connecting}>
                {connecting ? "Conectando..." : "Conectar"}
              </Button>
              {error && <p className="text-sm text-danger">{error}</p>}
            </form>
          </Card>
        )
      )}
    </div>
  );
}

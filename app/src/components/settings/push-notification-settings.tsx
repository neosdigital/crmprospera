"use client";

import { useState } from "react";
import useSWR from "swr";
import { Smartphone, Trash2 } from "lucide-react";
import { fetcher, poster, FetchError } from "@/lib/fetcher";
import { Card, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePushSubscription, type PushStatus } from "@/hooks/use-push-subscription";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_LABEL: Record<PushStatus, string> = {
  loading: "Verificando...",
  unsupported: "Este navegador não suporta notificações push",
  "ios-not-installed": "Precisa adicionar à Tela de Início primeiro (iPhone)",
  default: "Ainda não ativado neste dispositivo",
  denied: "Bloqueado nas configurações do navegador",
  subscribed: "Ativado neste dispositivo",
  "not-subscribed": "Desativado neste dispositivo",
};

const STATUS_TONE: Record<PushStatus, "neutral" | "gold" | "success" | "danger"> = {
  loading: "neutral",
  unsupported: "neutral",
  "ios-not-installed": "gold",
  default: "gold",
  denied: "danger",
  subscribed: "success",
  "not-subscribed": "neutral",
};

type DeviceSubscription = {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
};

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Dispositivo desconhecido";
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android";
  if (/Macintosh/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows";
  return "Navegador";
}

export function PushNotificationSettings({ isAdmin }: { isAdmin: boolean }) {
  const { status, busy, error, activate, deactivate } = usePushSubscription();
  const { data, mutate } = useSWR<{ subscriptions: DeviceSubscription[] }>("/api/push/subscriptions", fetcher);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function removeDevice(id: string) {
    await fetch(`/api/push/subscriptions/${id}`, { method: "DELETE" });
    mutate();
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await poster<{ sent: number }>("/api/push/test");
      setTestResult(`Enviado para ${result.sent} dispositivo(s). Confira se a notificação chegou.`);
    } catch (err) {
      setTestResult(err instanceof FetchError ? err.message : "Não foi possível enviar a notificação de teste.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardLabel>Neste dispositivo</CardLabel>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
          <div className="flex gap-2">
            {(status === "default" || status === "not-subscribed" || status === "denied") && (
              <Button onClick={activate} disabled={busy || status === "denied"} className="text-xs">
                {busy ? "Ativando..." : "Ativar notificações"}
              </Button>
            )}
            {status === "subscribed" && (
              <Button variant="secondary" onClick={() => deactivate().then(() => mutate())} disabled={busy} className="text-xs">
                {busy ? "Desativando..." : "Desativar neste dispositivo"}
              </Button>
            )}
          </div>
        </div>
        {status === "ios-not-installed" && (
          <p className="mt-2 text-xs text-text-secondary">
            No iPhone: toque em Compartilhar → &quot;Adicionar à Tela de Início&quot;, abra o CRM a partir do
            ícone criado, e volte aqui pra ativar.
          </p>
        )}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </Card>

      <Card>
        <CardLabel>Dispositivos com notificação ativada</CardLabel>
        <div className="mt-3 space-y-2">
          {data?.subscriptions.length === 0 && (
            <p className="text-sm text-text-secondary">Nenhum dispositivo ativado ainda.</p>
          )}
          {data?.subscriptions.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--color-border-gold)] px-3 py-2.5"
            >
              <div className="flex items-center gap-2.5 text-sm">
                <Smartphone size={16} className="text-text-secondary" />
                <div>
                  <p className="text-foreground">{deviceLabel(sub.userAgent)}</p>
                  <p className="text-xs text-text-secondary">
                    Ativado em {format(new Date(sub.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    {sub.lastError && <span className="text-danger"> — último erro: {sub.lastError}</span>}
                  </p>
                </div>
              </div>
              <button
                onClick={() => removeDevice(sub.id)}
                className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-2 hover:text-danger"
                aria-label="Remover dispositivo"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </Card>

      {isAdmin && (
        <Card>
          <CardLabel>Testar</CardLabel>
          <p className="mt-2 text-sm text-text-secondary">
            Envia uma notificação de teste para todos os seus dispositivos ativados.
          </p>
          <Button variant="secondary" className="mt-3 text-xs" onClick={sendTest} disabled={testing}>
            {testing ? "Enviando..." : "Enviar notificação de teste"}
          </Button>
          {testResult && <p className="mt-2 text-xs text-text-secondary">{testResult}</p>}
        </Card>
      )}
    </div>
  );
}

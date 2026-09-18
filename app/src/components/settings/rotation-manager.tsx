"use client";

import { useState } from "react";
import useSWR from "swr";
import { ArrowUp, ArrowDown, Plus } from "lucide-react";
import { fetcher, poster, FetchError } from "@/lib/fetcher";
import { Card, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Broker = {
  id: string;
  displayName: string;
  phone: string | null;
  status: "ACTIVE" | "PAUSED" | "INACTIVE";
  isInRotation: boolean;
  rotationPosition: number;
  user: { email: string; name: string };
};

export function RotationManager() {
  const { data, mutate, isLoading } = useSWR<{ brokers: Broker[] }>("/api/brokers", fetcher);
  const [showAdd, setShowAdd] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdInfo, setCreatedInfo] = useState<{ email: string; tempPassword: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function toggleActive(broker: Broker) {
    const nextStatus = broker.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    await fetch(`/api/brokers/${broker.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus, isInRotation: nextStatus === "ACTIVE" }),
    });
    mutate();
  }

  async function move(id: string, direction: "up" | "down") {
    await poster(`/api/brokers/${id}/move`, { direction });
    mutate();
  }

  async function createBroker(formData: FormData) {
    setCreating(true);
    setFormError(null);
    try {
      const result = await poster<{ broker: Broker; tempPassword: string }>("/api/brokers", {
        name: formData.get("name"),
        email: formData.get("email"),
        phone: formData.get("phone") || undefined,
      });
      setCreatedInfo({ email: result.broker.user?.email ?? String(formData.get("email")), tempPassword: result.tempPassword });
      mutate();
    } catch (err) {
      setFormError(err instanceof FetchError ? err.message : "Não foi possível criar o corretor.");
    } finally {
      setCreating(false);
    }
  }

  const brokers = data?.brokers ?? [];

  return (
    <div className="px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Roleta de atendimento</h1>
          <p className="mt-1 text-text-secondary">Ordem de distribuição automática dos leads entre corretores.</p>
        </div>
        <Button onClick={() => setShowAdd((v) => !v)} className="w-full sm:w-auto">
          <Plus size={16} />
          Adicionar corretor
        </Button>
      </div>

      {showAdd && (
        <Card className="mb-6">
          <CardLabel>Novo corretor</CardLabel>
          <form
            action={(fd) => createBroker(fd)}
            className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            <Input name="name" placeholder="Nome completo" required />
            <Input name="email" type="email" placeholder="Email" required />
            <Input name="phone" placeholder="Telefone (opcional)" />
            <Button type="submit" disabled={creating} className="sm:col-span-3">
              {creating ? "Criando..." : "Criar corretor"}
            </Button>
          </form>
          {formError && <p className="mt-2 text-sm text-danger">{formError}</p>}
          {createdInfo && (
            <p className="mt-3 rounded-lg bg-gold-soft px-3 py-2 text-sm text-gold">
              Corretor criado. Senha temporária para <strong>{createdInfo.email}</strong>:{" "}
              <code>{createdInfo.tempPassword}</code> — compartilhe com segurança.
            </p>
          )}
        </Card>
      )}

      <Card className="p-0">
        {isLoading && <p className="p-6 text-text-secondary">Carregando...</p>}
        <ul>
          {brokers.map((b, idx) => (
            <li
              key={b.id}
              className="flex flex-col gap-3 border-b border-[color:var(--color-border-gold)]/40 px-5 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-4">
                <span className="w-6 shrink-0 text-sm text-text-secondary">{String(idx + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{b.displayName}</p>
                  <p className="truncate text-xs text-text-secondary">{b.user.email}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pl-10 sm:pl-0">
                <Badge tone={b.status === "ACTIVE" && b.isInRotation ? "success" : "neutral"}>
                  {b.status === "ACTIVE" && b.isInRotation ? "ATIVO" : b.status === "PAUSED" ? "PAUSADO" : "INATIVO"}
                </Badge>
                <button
                  onClick={() => move(b.id, "up")}
                  className="rounded-lg p-2 text-text-secondary hover:bg-surface-2 hover:text-foreground"
                  aria-label="Mover para cima"
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  onClick={() => move(b.id, "down")}
                  className="rounded-lg p-2 text-text-secondary hover:bg-surface-2 hover:text-foreground"
                  aria-label="Mover para baixo"
                >
                  <ArrowDown size={16} />
                </button>
                <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => toggleActive(b)}>
                  {b.status === "ACTIVE" ? "Pausar" : "Ativar"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {!isLoading && brokers.length === 0 && (
          <p className="p-6 text-center text-text-secondary">Nenhum corretor cadastrado ainda.</p>
        )}
      </Card>
    </div>
  );
}

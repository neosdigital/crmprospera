"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { fetcher, patcher, FetchError } from "@/lib/fetcher";
import { brokerStatusLabel } from "@/lib/labels";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CONNECTION_STATUS, type PersonalConnection } from "./shared";

type BrokerRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  accessEnabled: boolean;
  personalLeads: number;
  connections: PersonalConnection[];
};

/** Dono/Admin: quem tem acesso à Área do Corretor, status das integrações e atalho para cada carteira. */
export function PersonalAdmin() {
  const { data, mutate, isLoading, error: loadError } = useSWR<{ brokers: BrokerRow[] }>("/api/personal/admin/brokers", fetcher, {
    refreshInterval: 30000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(broker: BrokerRow) {
    const enabling = !broker.accessEnabled;
    if (
      !enabling &&
      !confirm(
        `Desativar a Área do Corretor de ${broker.name}? Ele perde o acesso e os leads novos deixam de entrar. Os leads já recebidos ficam guardados.`
      )
    )
      return;
    setBusy(broker.id);
    setError(null);
    try {
      await patcher(`/api/personal/admin/brokers/${broker.id}`, { enabled: enabling });
      await mutate();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : "Não foi possível salvar.");
    } finally {
      setBusy(null);
    }
  }

  const brokers = data?.brokers ?? [];

  return (
    <div className="px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Área do Corretor</h1>
      <p className="mt-1 max-w-3xl text-text-secondary">
        Libere para os corretores que têm conta de anúncios própria. A Página do Facebook de cada um pode ser conectada pelo próprio corretor ou
        por você, em “Ver carteira”. Os leads das campanhas particulares vão para uma carteira exclusiva do corretor — sem passar pela roleta e sem mudar nada na operação geral.
      </p>

      {error && <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {isLoading ? (
        <p className="mt-6 text-text-secondary">Carregando...</p>
      ) : loadError && !data ? (
        <Card className="mt-6 text-danger">
          Não foi possível carregar os corretores: {loadError.message} Se a Área do Corretor acabou de ser publicada, confira se
          a migração do banco já foi aplicada.
        </Card>
      ) : brokers.length === 0 ? (
        <Card className="mt-6 text-text-secondary">Nenhum corretor cadastrado.</Card>
      ) : (
        <div className="mt-6 space-y-3">
          {brokers.map((b) => {
            const active = b.connections.filter((c) => c.isActive);
            return (
              <Card key={b.id} className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">
                    {b.name}
                    {b.status !== "ACTIVE" && <span className="ml-2 text-xs text-text-secondary">({brokerStatusLabel(b.status)})</span>}
                  </p>
                  <p className="truncate text-xs text-text-secondary">{b.email}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {active.length === 0 ? (
                      <Badge>Sem integração</Badge>
                    ) : (
                      active.map((c) => {
                        const s = CONNECTION_STATUS[c.status] ?? CONNECTION_STATUS.ERROR;
                        return (
                          <Badge key={c.id} tone={s.tone}>
                            {c.pageName ?? c.pageId}: {s.label}
                          </Badge>
                        );
                      })
                    )}
                    <Badge tone="gold">{b.personalLeads} lead(s) particular(es)</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={b.accessEnabled}
                    disabled={busy === b.id}
                    onClick={() => toggle(b)}
                    className="flex items-center gap-2 rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 px-3 py-2 text-sm"
                  >
                    <span
                      className={[
                        "relative inline-block h-5 w-9 rounded-full transition-colors",
                        b.accessEnabled ? "bg-gold" : "bg-surface",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "absolute top-0.5 h-4 w-4 rounded-full bg-[#FFFFF0] transition-all",
                          b.accessEnabled ? "left-[18px]" : "left-0.5",
                        ].join(" ")}
                      />
                    </span>
                    <span className="text-foreground">Acesso: {b.accessEnabled ? "ATIVADO" : "DESATIVADO"}</span>
                  </button>
                  {(b.accessEnabled || b.personalLeads > 0 || b.connections.length > 0) && (
                    <Link href={`/settings/area-do-corretor/${b.id}`}>
                      <Button variant="secondary">{active.length === 0 && b.accessEnabled ? "Conectar / ver carteira" : "Ver carteira"}</Button>
                    </Link>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { LeadsKanban } from "@/components/leads/leads-kanban";

/** Kanban do dono/admin: escolhe um corretor (ou todos) e vê/move os leads da carteira dele. */
export function OwnerKanban({ brokers }: { brokers: { id: string; displayName: string }[] }) {
  const [brokerId, setBrokerId] = useState("");

  return (
    <div className="px-4 py-8 sm:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Kanban dos corretores</h1>
          <p className="mt-1 text-text-secondary">
            Acompanhe a carteira de cada corretor. Arraste os cards para mudar o andamento.
          </p>
        </div>
        <select
          value={brokerId}
          onChange={(e) => setBrokerId(e.target.value)}
          aria-label="Filtrar por corretor"
          className="rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 px-4 py-2.5 text-sm text-foreground"
        >
          <option value="">Todos os corretores</option>
          {brokers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.displayName}
            </option>
          ))}
        </select>
      </div>

      <LeadsKanban
        key={brokerId}
        endpoint={brokerId ? `/api/kanban?brokerId=${encodeURIComponent(brokerId)}` : "/api/kanban"}
        emptyMessage={
          brokerId ? "Este corretor ainda não tem leads na carteira." : "Nenhum corretor tem leads na carteira ainda."
        }
      />
    </div>
  );
}

"use client";

import { LeadsKanban } from "@/components/leads/leads-kanban";

export function BrokerKanban() {
  return (
    <div className="px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Minha carteira</h1>
      <p className="mt-1 text-text-secondary">
        Arraste os cards entre as colunas para atualizar o andamento de cada lead.
      </p>
      <LeadsKanban
        endpoint="/api/broker/wallet"
        emptyMessage="Sua carteira ainda não tem leads. Quando você entrar em contato com um lead a tempo, ele aparece aqui."
      />
    </div>
  );
}

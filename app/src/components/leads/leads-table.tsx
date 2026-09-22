"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleter, FetchError } from "@/lib/fetcher";

export type LeadRow = {
  id: string;
  name: string;
  phone: string | null;
  campaignName: string | null;
  brokerName: string | null;
  status: string;
  statusLabel: string;
  statusTone: "neutral" | "gold" | "success" | "danger";
  createdAtLabel: string;
};

/**
 * Tabela de leads com seleção manual + exclusão em massa (botão "Remover leads").
 * Só é renderizada dentro de /leads, que já é uma rota exclusiva de dono/admin
 * (middleware redireciona corretor pra /broker/dashboard antes de chegar aqui) — e a
 * API de exclusão confere o role de novo, então não há caminho pra um corretor apagar
 * lead mesmo burlando a UI.
 */
export function LeadsTable({ leads }: { leads: LeadRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const allSelected = leads.length > 0 && selected.size === leads.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete() {
    const count = selected.size;
    if (count === 0) return;
    const confirmed = window.confirm(
      count === 1
        ? "Remover este lead? Essa ação não pode ser desfeita."
        : `Remover ${count} leads selecionados? Essa ação não pode ser desfeita.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setErrorMsg(null);
    try {
      await deleter("/api/leads", { ids: Array.from(selected) });
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof FetchError ? err.message : "Não foi possível remover os leads selecionados.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="text-xs text-text-secondary">
          {selected.size > 0 ? `${selected.size} selecionado(s)` : "Selecione leads pra remover"}
        </p>
        {selected.size > 0 && (
          <Button type="button" variant="secondary" onClick={handleDelete} disabled={deleting}>
            <Trash2 size={16} />
            {deleting ? "Removendo..." : `Remover ${selected.size === 1 ? "lead" : "leads"}`}
          </Button>
        )}
      </div>
      {errorMsg && <p className="px-4 pb-2 text-xs text-danger">{errorMsg}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border-gold)] text-left text-xs uppercase text-text-secondary">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Selecionar todos os leads"
                  className="h-4 w-4 accent-gold"
                />
              </th>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Telefone</th>
              <th className="px-4 py-3">Campanha</th>
              <th className="px-4 py-3">Corretor</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Recebido em</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr
                key={lead.id}
                className="border-b border-[color:var(--color-border-gold)]/40 last:border-0 hover:bg-surface-2"
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(lead.id)}
                    onChange={() => toggleOne(lead.id)}
                    aria-label={`Selecionar ${lead.name}`}
                    className="h-4 w-4 accent-gold"
                  />
                </td>
                <td className="px-4 py-3">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-foreground hover:text-gold">
                    {lead.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-text-secondary">{lead.phone ?? "—"}</td>
                <td className="px-4 py-3 text-text-secondary">{lead.campaignName ?? "—"}</td>
                <td className="px-4 py-3 text-text-secondary">{lead.brokerName ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge tone={lead.statusTone}>{lead.statusLabel}</Badge>
                </td>
                <td className="px-4 py-3 text-text-secondary">{lead.createdAtLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 && (
          <p className="px-4 py-10 text-center text-text-secondary">Nenhum lead encontrado com esses filtros.</p>
        )}
      </div>
    </div>
  );
}

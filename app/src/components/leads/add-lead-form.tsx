"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X } from "lucide-react";
import { poster, FetchError } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type BrokerOption = { id: string; displayName: string; status: string };

const EMPTY = { name: "", phone: "", email: "", campaignName: "", notes: "", brokerId: "" };

/**
 * Cadastro manual de lead (só aparece em /leads, área exclusiva de dono/admin; a API também
 * confere o role). O destino pode ser a roleta (automático) ou um corretor específico —
 * nesse caso o lead vai direto pra carteira dele, sem cronômetro.
 */
export function AddLeadForm({ brokers }: { brokers: BrokerOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function update(field: keyof typeof EMPTY, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const name = form.name.trim();
      const result = await poster<{ warning?: string }>("/api/leads", {
        name,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        campaignName: form.campaignName.trim() || undefined,
        notes: form.notes.trim() || undefined,
        brokerId: form.brokerId || undefined,
      });
      const brokerName = brokers.find((b) => b.id === form.brokerId)?.displayName;
      setSuccessMsg(
        result.warning ??
          (brokerName
            ? `Lead "${name}" adicionado à carteira de ${brokerName}.`
            : `Lead "${name}" criado e enviado para a roleta.`)
      );
      setForm(EMPTY);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof FetchError ? err.message : "Não foi possível adicionar o lead.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full">
      <div className="flex flex-col items-start gap-1 sm:items-end">
        {!open && (
          <Button type="button" onClick={() => setOpen(true)}>
            <UserPlus size={16} />
            Adicionar lead
          </Button>
        )}
        {successMsg && !open && <p className="text-xs text-text-secondary">{successMsg}</p>}
      </div>

      {open && (
        <Card>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold uppercase tracking-wide text-foreground">Novo lead</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-2"
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input required placeholder="Nome *" value={form.name} onChange={(e) => update("name", e.target.value)} />
            <Input placeholder="Telefone" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
            <Input
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
            />
            <Input
              placeholder="Campanha / origem"
              value={form.campaignName}
              onChange={(e) => update("campaignName", e.target.value)}
            />

            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-xs uppercase tracking-wide text-text-secondary">Direcionar para</span>
              <select
                value={form.brokerId}
                onChange={(e) => update("brokerId", e.target.value)}
                className="w-full rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 px-4 py-2.5 text-sm text-foreground"
              >
                <option value="">Roleta (automático)</option>
                {brokers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.displayName}
                    {b.status === "PAUSED" ? " (pausado)" : ""}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-text-secondary">
                {form.brokerId
                  ? "O lead vai direto para a carteira deste corretor, sem cronômetro."
                  : "O lead segue a roleta normal, com prazo de resposta."}
              </span>
            </label>

            <Textarea
              rows={3}
              placeholder="Observação (opcional)"
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              className="text-sm sm:col-span-2"
            />

            {errorMsg && <p className="text-xs text-danger sm:col-span-2">{errorMsg}</p>}

            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={saving || !form.name.trim()}>
                {saving ? "Salvando..." : "Adicionar lead"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

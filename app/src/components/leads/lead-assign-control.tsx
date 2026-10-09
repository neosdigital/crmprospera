"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";
import { poster, FetchError } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import type { BrokerOption } from "@/components/leads/add-lead-form";

const ROTATION = "__rotation__";

/** Transferência manual (dono/admin) de um lead para outro corretor ou de volta pra roleta. */
export function LeadAssignControl({
  leadId,
  currentBrokerId,
  brokers,
}: {
  leadId: string;
  currentBrokerId: string | null;
  brokers: BrokerOption[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  async function handleTransfer() {
    if (!target) return;
    setSaving(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const result = await poster<{ warning?: string }>(`/api/leads/${leadId}/assign`, {
        brokerId: target === ROTATION ? null : target,
      });
      setInfoMsg(result.warning ?? (target === ROTATION ? "Lead devolvido para a roleta." : "Lead transferido."));
      setTarget("");
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof FetchError ? err.message : "Não foi possível transferir o lead.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-xs uppercase tracking-wide text-text-secondary">Transferir lead</p>
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        aria-label="Destino da transferência"
        className="w-full rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 px-3 py-2 text-sm text-foreground"
      >
        <option value="">Escolha o destino...</option>
        <option value={ROTATION}>Devolver para a roleta</option>
        {brokers
          .filter((b) => b.id !== currentBrokerId)
          .map((b) => (
            <option key={b.id} value={b.id}>
              {b.displayName}
              {b.status === "PAUSED" ? " (pausado)" : ""}
            </option>
          ))}
      </select>
      {target && (
        <Button variant="secondary" className="mt-2 py-1.5 text-xs" disabled={saving} onClick={handleTransfer}>
          <ArrowRightLeft size={13} />
          {saving ? "Transferindo..." : "Confirmar transferência"}
        </Button>
      )}
      {errorMsg && <p className="mt-1.5 text-xs text-danger">{errorMsg}</p>}
      {infoMsg && <p className="mt-1.5 text-xs text-text-secondary">{infoMsg}</p>}
    </div>
  );
}

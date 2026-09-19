"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { patcher } from "@/lib/fetcher";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function LeadNotesEditor({
  leadId,
  initialNotes,
  onSaved,
  compact = false,
}: {
  leadId: string;
  initialNotes: string | null;
  onSaved?: () => void;
  compact?: boolean;
}) {
  const [value, setValue] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const dirty = value !== (initialNotes ?? "");

  async function save() {
    setSaving(true);
    setErrorMsg(null);
    try {
      await patcher(`/api/leads/${leadId}`, { notes: value });
      onSaved?.();
    } catch {
      setErrorMsg("Não foi possível salvar a observação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {!compact && <p className="mb-1.5 text-xs uppercase tracking-wide text-text-secondary">Observação</p>}
      <Textarea
        rows={compact ? 2 : 4}
        placeholder="Anote detalhes deste atendimento..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={compact ? "text-xs" : "text-sm"}
      />
      {errorMsg && <p className="mt-1.5 text-xs text-danger">{errorMsg}</p>}
      {dirty && (
        <Button
          variant="secondary"
          className={compact ? "mt-2 w-full py-1.5 text-xs" : "mt-2 py-1.5 text-xs"}
          disabled={saving}
          onClick={save}
        >
          <Save size={13} />
          {saving ? "Salvando..." : "Salvar observação"}
        </Button>
      )}
    </div>
  );
}

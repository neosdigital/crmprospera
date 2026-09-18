"use client";

import { useState } from "react";
import { Card, CardLabel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function OrgSettingsForm({
  initialName,
  initialTimeout,
}: {
  initialName: string;
  initialTimeout: number;
}) {
  const [name, setName] = useState(initialName);
  const [timeout, setTimeoutValue] = useState(initialTimeout);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, responseTimeoutMinutes: timeout }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <CardLabel>Organização</CardLabel>
      <div className="mt-3 space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-secondary">Nome da imobiliária</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-secondary">
            Tempo de resposta por corretor (minutos)
          </label>
          <Input
            type="number"
            min={1}
            max={120}
            value={timeout}
            onChange={(e) => setTimeoutValue(Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-text-secondary">
            Quanto tempo cada corretor tem para clicar em &quot;Entrar em contato&quot; antes do lead
            ser transferido automaticamente para o próximo da roleta. Vale apenas para novas
            atribuições.
          </p>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
        {saved && <p className="text-sm text-success">Salvo com sucesso.</p>}
      </div>
    </Card>
  );
}

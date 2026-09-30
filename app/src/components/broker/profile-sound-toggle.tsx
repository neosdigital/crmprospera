"use client";

import { useState } from "react";

export function ProfileSoundToggle({ initialValue }: { initialValue: boolean }) {
  const [enabled, setEnabled] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    try {
      const res = await fetch("/api/broker/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soundEnabled: next }),
      });
      // Preferência fica salva no banco (brokers.sound_enabled); se não salvou, volta o botão.
      if (!res.ok) setEnabled(!next);
    } catch {
      setEnabled(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between border-t border-[color:var(--color-border-gold)] pt-4">
      <div>
        <p className="text-sm text-foreground">Som das notificações: {enabled ? "ativado" : "desativado"}</p>
        <p className="text-xs text-text-secondary">
          Toca um alerta sonoro (e vibra no celular) quando um lead chega na sua vez
        </p>
      </div>
      <button
        onClick={toggle}
        disabled={saving}
        role="switch"
        aria-checked={enabled}
        aria-label="Som das notificações"
        className={[
          "h-6 w-11 rounded-full transition-colors",
          enabled ? "bg-gold" : "bg-surface-2",
        ].join(" ")}
      >
        <span
          className={[
            "block h-5 w-5 translate-x-0.5 rounded-full bg-[#191919] transition-transform",
            enabled ? "translate-x-[22px]" : "",
          ].join(" ")}
        />
      </button>
    </div>
  );
}

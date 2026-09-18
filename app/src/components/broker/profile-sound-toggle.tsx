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
      await fetch("/api/broker/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soundEnabled: next }),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between border-t border-[color:var(--color-border-gold)] pt-4">
      <div>
        <p className="text-sm text-foreground">Som ao receber novo lead</p>
        <p className="text-xs text-text-secondary">Toca um alerta sonoro quando um lead novo chega</p>
      </div>
      <button
        onClick={toggle}
        disabled={saving}
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

"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LOST_RETURN_PRESETS, LOST_RETURN_MAX_MONTHS, type LostReturnPeriod } from "@/lib/lost-return";

/**
 * Pergunta exibida ao mover um lead para "Perdidos": "Em quanto tempo esse lead volta para a
 * roleta?". Cancelar não move o lead. A data de retorno é calculada no servidor.
 */
export function LostReturnDialog({
  leadName,
  onCancel,
  onConfirm,
}: {
  leadName: string;
  onCancel: () => void;
  onConfirm: (period: LostReturnPeriod) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [months, setMonths] = useState("");

  const monthsNumber = Number(months);
  const customError =
    months === ""
      ? null
      : !Number.isInteger(monthsNumber) || monthsNumber < 1
        ? "Informe um número inteiro de meses, a partir de 1."
        : monthsNumber > LOST_RETURN_MAX_MONTHS
          ? `O máximo é ${LOST_RETURN_MAX_MONTHS} meses.`
          : null;
  const customValid = months !== "" && customError === null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Em quanto tempo esse lead volta para a roleta?"
        className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border-gold)] bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">Em quanto tempo esse lead volta para a roleta?</p>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-2"
            aria-label="Cancelar"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mt-0.5 truncate text-xs text-text-secondary">{leadName}</p>

        <div className="mt-3 space-y-1.5">
          {LOST_RETURN_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onConfirm(preset.period)}
              className="flex w-full items-center rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:border-[color:var(--color-border-gold-strong)]"
            >
              {preset.label}
            </button>
          ))}

          {!custom ? (
            <button
              type="button"
              onClick={() => setCustom(true)}
              className="flex w-full items-center rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:border-[color:var(--color-border-gold-strong)]"
            >
              Outro período
            </button>
          ) : (
            <form
              className="rounded-xl border border-[color:var(--color-border-gold-strong)] bg-surface-2 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (customValid) onConfirm({ unit: "months", amount: monthsNumber });
              }}
            >
              <label className="block text-xs text-text-secondary" htmlFor="lost-return-months">
                Quantos meses?
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  id="lost-return-months"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={LOST_RETURN_MAX_MONTHS}
                  step={1}
                  autoFocus
                  placeholder="Ex.: 3"
                  value={months}
                  onChange={(e) => setMonths(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-text-secondary">meses</span>
                <Button type="submit" className="ml-auto py-2 text-xs" disabled={!customValid}>
                  Confirmar
                </Button>
              </div>
              {customError && <p className="mt-1.5 text-xs text-danger">{customError}</p>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

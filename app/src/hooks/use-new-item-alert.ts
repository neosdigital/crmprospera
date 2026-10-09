"use client";

import { useEffect, useRef } from "react";
import { playLeadAlertSound, showLeadNotification } from "@/lib/alerts";
import { isQuietHours } from "@/lib/quiet-hours";

/**
 * Dispara som + notificação do navegador quando IDs novos aparecem numa lista que é
 * atualizada via polling (SWR). Não alerta na primeira renderização (evita "alarme falso"
 * para leads que já existiam quando a página carregou) — só a partir da segunda leitura.
 * No horário de silêncio (23h–07h) não toca som nem mostra notificação; a lista continua
 * atualizando e os IDs seguem sendo marcados como vistos, então nada acumula pra
 * disparar de uma vez às 07h.
 */
export function useNewItemAlert(
  ids: string[],
  options: { enabled?: boolean; soundEnabled?: boolean; notify?: (newIds: string[]) => void } = {}
) {
  const { enabled = true, soundEnabled = true, notify } = options;
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (seenRef.current === null) {
      seenRef.current = new Set(ids);
      return;
    }

    const newIds = ids.filter((id) => !seenRef.current!.has(id));
    if (enabled && newIds.length > 0 && !isQuietHours()) {
      if (soundEnabled) playLeadAlertSound();
      notify?.(newIds);
    }

    seenRef.current = new Set(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);
}

export { showLeadNotification };

"use client";

import { useEffect, useRef } from "react";
import { playLeadAlertSound, showLeadNotification } from "@/lib/alerts";

/**
 * Dispara som + notificação do navegador quando IDs novos aparecem numa lista que é
 * atualizada via polling (SWR). Não alerta na primeira renderização (evita "alarme falso"
 * para leads que já existiam quando a página carregou) — só a partir da segunda leitura.
 */
export function useNewItemAlert(
  ids: string[],
  options: { soundEnabled?: boolean; notify?: (newIds: string[]) => void } = {}
) {
  const { soundEnabled = true, notify } = options;
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (seenRef.current === null) {
      seenRef.current = new Set(ids);
      return;
    }

    const newIds = ids.filter((id) => !seenRef.current!.has(id));
    if (newIds.length > 0) {
      if (soundEnabled) playLeadAlertSound();
      notify?.(newIds);
    }

    seenRef.current = new Set(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);
}

export { showLeadNotification };

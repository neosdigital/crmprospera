"use client";

import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { isAudioReady, playLeadAlertSound, unlockAudio } from "@/lib/alerts";

/**
 * Som das notificações em QUALQUER página do corretor (dashboard, carteira, ao vivo...).
 * Quando chega um push com o app aberto, o sw.js avisa esta aba ("crm-push") e aqui tocamos o
 * alerta sonoro do app — o sistema operacional costuma não tocar som para notificação de app
 * em primeiro plano. Respeita a preferência "Som das notificações" (o servidor manda
 * `silent: true` quando o corretor desligou).
 *
 * Navegadores só liberam áudio depois de uma interação na página: destravamos no primeiro
 * toque/clique/tecla. Se um alerta chegar antes disso, aparece um aviso pequeno no rodapé
 * ("Toque para ativar o som dos alertas") — sem popup, some no primeiro toque.
 */
export function BrokerAlertListener() {
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      setNeedsTap(false);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    // iOS suspende o áudio quando o app vai para segundo plano — volta a destravar ao retornar.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !isAudioReady()) unlockAudio();
    };
    document.addEventListener("visibilitychange", onVisible);

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; silent?: boolean } | null;
      if (data?.type !== "crm-push" || data.silent) return;
      playLeadAlertSound();
      if (!isAudioReady()) setNeedsTap(true);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, []);

  if (!needsTap) return null;

  return (
    <button
      type="button"
      onClick={() => {
        unlockAudio();
        playLeadAlertSound();
        setNeedsTap(false);
      }}
      className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[color:var(--color-border-gold)] bg-surface px-4 py-2 text-xs text-foreground shadow-lg"
    >
      <Volume2 size={14} className="text-gold" />
      Toque para ativar o som dos alertas
    </button>
  );
}

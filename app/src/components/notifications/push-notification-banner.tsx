"use client";

import { useEffect, useState } from "react";
import { Bell, X, Share } from "lucide-react";
import { unlockAudio } from "@/lib/alerts";
import { usePushSubscription } from "@/hooks/use-push-subscription";

/**
 * Substitui o antigo NotificationPermissionBanner (só pedia permissão da Notification API
 * in-tab). Esse aqui faz o fluxo completo de Web Push — permissão + Service Worker +
 * inscrição — pra funcionar mesmo com o CRM fechado, não só com a aba aberta.
 */
export function PushNotificationBanner() {
  const { status, busy, error, activate } = usePushSubscription();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const unlock = () => unlockAudio();
    document.addEventListener("click", unlock, { once: true });
    document.addEventListener("touchstart", unlock, { once: true });
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
    };
  }, []);

  if (dismissed) return null;
  if (status === "loading" || status === "unsupported" || status === "subscribed") return null;

  if (status === "ios-not-installed") {
    return (
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[color:var(--color-border-gold-strong)] bg-gold-soft px-4 py-3">
        <div className="flex items-start gap-2 text-sm text-gold">
          <Share size={16} className="mt-0.5 shrink-0" />
          <span>
            Pra receber notificações no iPhone, adicione o CRM à Tela de Início: toque em{" "}
            <strong>Compartilhar</strong> e depois em <strong>&quot;Adicionar à Tela de Início&quot;</strong>.
          </span>
        </div>
        <button onClick={() => setDismissed(true)} className="p-1 text-gold/70 hover:text-gold" aria-label="Dispensar">
          <X size={16} />
        </button>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-danger">
          <Bell size={16} />
          Notificações bloqueadas neste navegador. Ative nas configurações do site pra receber avisos de novo lead.
        </div>
        <button onClick={() => setDismissed(true)} className="p-1 text-danger/70 hover:text-danger" aria-label="Dispensar">
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--color-border-gold-strong)] bg-gold-soft px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-gold">
        <Bell size={16} />
        Ative as notificações para ser avisado assim que um novo lead chegar — mesmo com o CRM fechado.
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            unlockAudio();
            activate();
          }}
          disabled={busy}
          className="rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-[#191919] disabled:opacity-60"
        >
          {busy ? "Ativando..." : "Ativar"}
        </button>
        <button onClick={() => setDismissed(true)} className="p-1 text-gold/70 hover:text-gold" aria-label="Dispensar">
          <X size={16} />
        </button>
      </div>
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </div>
  );
}

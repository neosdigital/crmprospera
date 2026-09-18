"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { getNotificationPermission, requestNotificationPermission, unlockAudio } from "@/lib/alerts";

export function NotificationPermissionBanner() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Lido só depois de montar no client (Notification.permission não existe no SSR) —
    // por isso não dá pra inicializar o state direto, precisa ser via efeito.
    const syncPermission = () => setPermission(getNotificationPermission());
    syncPermission();

    // Destrava o áudio assim que o usuário interagir pela primeira vez com a página.
    const unlock = () => unlockAudio();
    document.addEventListener("click", unlock, { once: true });
    document.addEventListener("touchstart", unlock, { once: true });
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
    };
  }, []);

  if (dismissed || !permission || permission !== "default") return null;

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--color-border-gold-strong)] bg-gold-soft px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-gold">
        <Bell size={16} />
        Ative as notificações para ser avisado assim que um novo lead chegar.
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={async () => {
            unlockAudio();
            const result = await requestNotificationPermission();
            setPermission(result);
          }}
          className="rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-[#191919]"
        >
          Ativar
        </button>
        <button onClick={() => setDismissed(true)} className="p-1 text-gold/70 hover:text-gold" aria-label="Dispensar">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

export type PushStatus =
  | "loading"
  | "unsupported"
  | "ios-not-installed"
  | "default"
  | "denied"
  | "subscribed"
  | "not-subscribed";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

/**
 * Gerencia o ciclo de vida da inscrição de Web Push deste navegador: registra o Service
 * Worker, pede permissão (só deve ser chamado a partir de um clique — iOS Safari é estrito
 * sobre isso), inscreve no PushManager e salva/remove no backend.
 */
export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!isSupported()) {
      setStatus(isIOS() ? "ios-not-installed" : "unsupported");
      return;
    }
    if (isIOS() && !isStandalone()) {
      setStatus("ios-not-installed");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    if (Notification.permission === "default") {
      setStatus("default");
      return;
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      setStatus(subscription ? "subscribed" : "not-subscribed");
    } catch {
      setStatus("not-subscribed");
    }
  }, []);

  useEffect(() => {
    const run = () => refreshStatus();
    run();
  }, [refreshStatus]);

  const activate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!isSupported()) throw new Error("Este navegador não suporta notificações push.");
      if (isIOS() && !isStandalone()) {
        throw new Error('No iPhone, adicione o CRM à Tela de Início primeiro (Compartilhar → "Adicionar à Tela de Início").');
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "default");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const keyRes = await fetch("/api/push/vapid-public-key");
      if (!keyRes.ok) throw new Error("Não foi possível obter a chave de notificações do servidor.");
      const { publicKey } = (await keyRes.json()) as { publicKey: string };

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        });
      }

      const json = subscription.toJSON();
      const saveRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!saveRes.ok) throw new Error("Não foi possível salvar a inscrição no servidor.");

      setStatus("subscribed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível ativar as notificações.");
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }, [refreshStatus]);

  const deactivate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
      setStatus("not-subscribed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível desativar as notificações.");
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, error, activate, deactivate, refreshStatus };
}

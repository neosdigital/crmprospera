"use client";

let audioCtx: AudioContext | null = null;
let unlocked = false;

/**
 * Navegadores bloqueiam áudio antes de qualquer interação do usuário na página.
 * Chamamos isto uma vez (no primeiro clique/toque) para "destravar" o contexto de
 * áudio, para que o som de alerta consiga tocar mais tarde quando um lead novo chegar
 * via polling (sem gesto do usuário naquele momento).
 */
export function unlockAudio() {
  if (unlocked) return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = audioCtx ?? new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
    unlocked = true;
  } catch {
    // Web Audio indisponível — o alerta visual/notificação continua funcionando normalmente.
  }
}

/** Toca um alerta sonoro curto de dois tons (sem depender de nenhum arquivo de áudio externo). */
export function playLeadAlertSound() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = audioCtx ?? new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();

    const now = audioCtx.currentTime;
    const tones = [880, 1175];
    tones.forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.16;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
      osc.connect(gain);
      gain.connect(audioCtx!.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch {
    // Silencioso — não deve quebrar a UI se o áudio falhar.
  }
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported" as const;
  return Notification.requestPermission();
}

export function showLeadNotification(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/logo-prospera.png", tag: `lead-${Date.now()}` });
  } catch {
    // Alguns navegadores mobile não suportam `new Notification()` fora de um Service Worker — ok ignorar.
  }
}

// Service Worker do CRM Próspera — só cuida de Web Push (não faz cache/offline de páginas,
// não interfere no funcionamento normal do app). Arquivo estático, servido direto de /sw.js
// (fora do bundler do Next.js).

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "Novo lead!", body: "Você tem um novo lead no CRM Próspera.", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // payload não veio em JSON — usa o texto puro como corpo da notificação
    if (event.data) payload.body = event.data.text();
  }

  // `silent` vem da preferência "Som das notificações" do corretor (servidor decide).
  const silent = payload.silent === true;

  const options = {
    body: payload.body,
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/icon-192.png",
    data: { url: payload.url || "/" },
    tag: payload.tag || "novo-lead",
    renotify: true,
    // Com o app fechado, o som é o da notificação do sistema (celular/computador). Com som
    // ativado, pede alerta sonoro + vibração; o volume final depende das configurações do aparelho.
    silent,
    vibrate: silent ? undefined : [300, 120, 300, 120, 300],
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, options),
      // Com o app ABERTO, o sistema muitas vezes não toca som para a notificação — então
      // avisa as abas abertas para tocarem o alerta sonoro do próprio app (BrokerAlertListener).
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          client.postMessage({ type: "crm-push", title: payload.title, silent });
        }
      }),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

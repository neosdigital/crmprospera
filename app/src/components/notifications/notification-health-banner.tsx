"use client";

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { fetcher } from "@/lib/fetcher";

type Issue = { severity: "critical" | "warning"; title: string; detail: string };

/**
 * Alerta no topo de todas as páginas do dono/admin quando alguma notificação dos corretores
 * não está saindo (ver getNotificationHealth em packages/db). Some sozinho quando está tudo
 * certo — não polui a tela no dia a dia.
 */
export function NotificationHealthBanner() {
  const { data } = useSWR<{ issues: Issue[] }>("/api/notifications/health", fetcher, { refreshInterval: 60_000 });
  const [open, setOpen] = useState(false);

  const issues = data?.issues ?? [];
  if (issues.length === 0) return null;

  const critical = issues.some((i) => i.severity === "critical");

  return (
    <div
      className={[
        "border-b px-4 py-2.5 text-sm sm:px-8",
        critical ? "border-danger/40 bg-danger/10 text-danger" : "border-[color:var(--color-border-gold)] bg-gold-soft text-foreground",
      ].join(" ")}
    >
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        <AlertTriangle size={16} className="shrink-0" />
        <span className="flex-1 font-medium">
          {critical ? "Notificações dos corretores com problema" : "Atenção nas notificações dos corretores"}
          {" — "}
          {issues[0].title}
          {issues.length > 1 ? ` (+${issues.length - 1})` : ""}
        </span>
        <ChevronDown size={16} className={["shrink-0 transition-transform", open ? "rotate-180" : ""].join(" ")} />
      </button>
      {open && (
        <ul className="mt-2 space-y-2 pl-6">
          {issues.map((issue) => (
            <li key={issue.title}>
              <p className="font-medium">{issue.title}</p>
              <p className="text-xs opacity-90">{issue.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

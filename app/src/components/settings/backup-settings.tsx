"use client";

import { useRef, useState } from "react";
import { Download, Upload, ShieldCheck, CheckCircle2 } from "lucide-react";
import { Card, CardLabel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatBrasilia } from "@/lib/brasilia-time";

type TableResult = { table: string; inFile: number; added: number; skipped: number };
type ImportResult = { applied: boolean; tables: TableResult[]; added: number; ignoredTables: string[]; backupCreatedAt?: string };

const TABLE_LABELS: Record<string, string> = {
  organizations: "Organização",
  users: "Usuários",
  brokers: "Corretores",
  rotation_state: "Estado da roleta",
  leads: "Leads",
  lead_assignments: "Passagens pela roleta",
  lead_notes: "Notas",
  lead_note_revisions: "Edições de notas",
  audit_logs: "Histórico de eventos",
  meta_integrations: "Integração com a Meta",
  whatsapp_integrations: "Integração com o WhatsApp",
  push_subscriptions: "Aparelhos com notificação",
};

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Configurações → Backup. "Baixar backup agora" gera o arquivo desta organização; "Adicionar
 * backup" mostra primeiro uma prévia e, ao confirmar, soma ao CRM só o que falta — nada é
 * apagado, sobrescrito ou duplicado (regra garantida no servidor, ver backup-merge.ts).
 */
export function BackupSettings() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(selected: File, mode: "preview" | "apply") {
    const body = new FormData();
    body.append("file", selected);
    body.append("mode", mode);
    const res = await fetch("/api/backup/import", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? "Não foi possível processar o backup.");
    return data as ImportResult;
  }

  async function analyze(selected: File) {
    setFile(selected);
    setPreview(null);
    setDone(null);
    setError(null);
    if (selected.size > MAX_UPLOAD_BYTES) {
      setError("O arquivo passa de 4 MB.");
      return;
    }
    setBusy("preview");
    try {
      setPreview(await send(selected, "preview"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!file || !preview) return;
    setBusy("apply");
    setError(null);
    try {
      setDone(await send(file, "apply"));
      setPreview(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setDone(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const visibleRows = (result: ImportResult) => result.tables.filter((t) => t.inFile > 0);

  return (
    <Card>
      <CardLabel>Backup</CardLabel>
      <p className="mt-2 text-sm text-text-secondary">
        O backup completo do CRM roda automaticamente todo dia. Aqui você pode baixar um backup desta
        imobiliária agora ou adicionar ao CRM as informações de um backup.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <a href="/api/backup/export" download>
          <Button type="button" variant="secondary" className="w-full sm:w-auto">
            <Download size={16} />
            Baixar backup agora
          </Button>
        </a>
        <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => inputRef.current?.click()}>
          <Upload size={16} />
          Adicionar backup
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".gz,.json,application/gzip,application/json"
          className="hidden"
          onChange={(e) => {
            const selected = e.target.files?.[0];
            if (selected) void analyze(selected);
          }}
        />
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-xs text-text-secondary">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-gold" />
        Ao adicionar um backup, o CRM só acrescenta o que ainda não tem. Nada é apagado nem sobrescrito,
        e registros que já existem não são duplicados.
      </p>

      {busy === "preview" && <p className="mt-4 text-sm text-text-secondary">Analisando {file?.name}...</p>}
      {error && <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {preview && (
        <div className="mt-4 rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 p-4">
          <p className="text-sm font-medium text-foreground">Prévia — nada foi gravado ainda</p>
          <p className="mt-0.5 text-xs text-text-secondary">
            {file?.name}
            {preview.backupCreatedAt &&
              ` · backup de ${formatBrasilia(preview.backupCreatedAt, "dd/MM/yyyy")} às ${formatBrasilia(preview.backupCreatedAt, "HH:mm")}`}
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-text-secondary">
                  <th className="py-1.5 pr-3">Informação</th>
                  <th className="py-1.5 pr-3 text-right">No backup</th>
                  <th className="py-1.5 pr-3 text-right">Já existem</th>
                  <th className="py-1.5 text-right">Serão adicionados</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows(preview).map((t) => (
                  <tr key={t.table} className="border-t border-[color:var(--color-border-gold)]/40">
                    <td className="py-1.5 pr-3 text-foreground">{TABLE_LABELS[t.table] ?? t.table}</td>
                    <td className="py-1.5 pr-3 text-right text-text-secondary">{t.inFile}</td>
                    <td className="py-1.5 pr-3 text-right text-text-secondary">{t.skipped}</td>
                    <td className={["py-1.5 text-right font-medium", t.added > 0 ? "text-gold" : "text-text-secondary"].join(" ")}>
                      {t.added}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibleRows(preview).length === 0 && (
            <p className="mt-2 text-sm text-text-secondary">Este backup não tem registros desta imobiliária.</p>
          )}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button type="button" disabled={busy !== null || preview.added === 0} onClick={apply}>
              {busy === "apply"
                ? "Adicionando..."
                : preview.added === 0
                  ? "O CRM já tem tudo deste backup"
                  : `Adicionar ${preview.added} registro(s) ao CRM`}
            </Button>
            <Button type="button" variant="ghost" disabled={busy !== null} onClick={reset}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {done && (
        <div className="mt-4 rounded-xl border border-success/40 bg-success/10 p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <CheckCircle2 size={16} className="text-success" />
            {done.added === 0 ? "Nada a adicionar: o CRM já tinha tudo." : `${done.added} registro(s) adicionado(s) ao CRM.`}
          </p>
          {done.added > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-text-secondary">
              {done.tables
                .filter((t) => t.added > 0)
                .map((t) => (
                  <li key={t.table}>
                    {TABLE_LABELS[t.table] ?? t.table}: +{t.added}
                  </li>
                ))}
            </ul>
          )}
          <Button type="button" variant="ghost" className="mt-2 px-0 text-xs" onClick={reset}>
            Fechar
          </Button>
        </div>
      )}
    </Card>
  );
}

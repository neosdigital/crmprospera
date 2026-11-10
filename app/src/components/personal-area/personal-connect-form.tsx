"use client";

import { useState } from "react";
import { KeyRound, Search, Check } from "lucide-react";
import { poster, FetchError } from "@/lib/fetcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Inspection = {
  kind: "USER" | "PAGE";
  ownerName: string | null;
  adAccounts: { id: string; name: string }[];
  pages: { id: string; name: string }[];
  selectedPageId: string | null;
  forms: { id: string; name: string; status?: string }[] | null;
  formsError: string | null;
};

/**
 * Conexão da Página particular do corretor. O token só fica na memória desta tela enquanto o
 * corretor conecta — é enviado ao servidor, que o valida na Meta e o guarda criptografado.
 * Nunca é devolvido ao navegador.
 */
export function PersonalConnectForm({ onConnected, onCancel }: { onConnected: () => void; onCancel?: () => void }) {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [pageId, setPageId] = useState<string>("");
  const [formIds, setFormIds] = useState<string[]>([]);
  const [manualForms, setManualForms] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [adAccountName, setAdAccountName] = useState("");
  const [loading, setLoading] = useState<"inspect" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function inspect(selectedPage?: string) {
    setError(null);
    setLoading("inspect");
    try {
      const res = await poster<Inspection>("/api/personal/connection/inspect", { token, pageId: selectedPage });
      setInspection(res);
      setPageId(res.selectedPageId ?? "");
      setFormIds((res.forms ?? []).filter((f) => !f.status || f.status === "ACTIVE").map((f) => f.id));
    } catch (err) {
      setError(err instanceof FetchError ? err.message : "Não foi possível verificar o token.");
    } finally {
      setLoading(null);
    }
  }

  async function save() {
    setError(null);
    const allForms = [...formIds, ...manualForms.split(/[\s,;]+/).map((f) => f.trim()).filter(Boolean)];
    if (!pageId) return setError("Escolha a Página.");
    if (allForms.length === 0) return setError("Escolha pelo menos um formulário de Lead Ads.");
    setLoading("save");
    try {
      const account = inspection?.adAccounts.find((a) => a.id === adAccountId);
      await poster("/api/personal/connection", {
        token,
        pageId,
        formIds: allForms,
        name: name || undefined,
        adAccountId: adAccountId || null,
        adAccountName: account?.name ?? (adAccountName || null),
      });
      setToken("");
      onConnected();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : "Não foi possível salvar a conexão.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <p className="flex items-center gap-2 text-base font-semibold text-foreground">
          <KeyRound size={16} className="text-gold" />
          Conectar minha conta Meta
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Cole um token de acesso da sua conta (de Usuário ou da sua Página). O CRM nunca pede a sua senha do
          Facebook. O token precisa das permissões <span className="text-foreground">pages_show_list</span>,{" "}
          <span className="text-foreground">leads_retrieval</span> e{" "}
          <span className="text-foreground">pages_read_engagement</span> (e{" "}
          <span className="text-foreground">ads_read</span> para listar suas contas de anúncios).
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Nome da integração</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Minhas campanhas de Itajaí" maxLength={120} />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Token de acesso</label>
        <Textarea
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setInspection(null);
          }}
          rows={3}
          placeholder="EAAB..."
          autoComplete="off"
          spellCheck={false}
        />
        <Button variant="secondary" onClick={() => inspect()} disabled={token.trim().length < 10 || loading !== null}>
          <Search size={14} />
          {loading === "inspect" ? "Verificando..." : "Verificar token"}
        </Button>
      </div>

      {inspection && (
        <div className="space-y-4 border-t border-[color:var(--color-border-gold)] pt-4">
          {inspection.ownerName && (
            <p className="text-sm text-text-secondary">
              Conta autorizada: <span className="text-foreground">{inspection.ownerName}</span>
            </p>
          )}

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Página do Facebook</label>
            <select
              value={pageId}
              onChange={(e) => {
                setPageId(e.target.value);
                if (e.target.value) void inspect(e.target.value);
              }}
              className="w-full rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 px-4 py-2.5 text-sm text-foreground"
            >
              <option value="">Selecione a sua Página</option>
              {inspection.pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.id})
                </option>
              ))}
            </select>
          </div>

          {pageId && (
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Formulários de Lead Ads</label>
              {inspection.forms && inspection.forms.length > 0 ? (
                <div className="space-y-1.5">
                  {inspection.forms.map((f) => {
                    const checked = formIds.includes(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFormIds((ids) => (checked ? ids.filter((i) => i !== f.id) : [...ids, f.id]))}
                        className={[
                          "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm",
                          checked
                            ? "border-[color:var(--color-border-gold-strong)] bg-gold-soft text-foreground"
                            : "border-[color:var(--color-border-gold)] bg-surface-2 text-text-secondary",
                        ].join(" ")}
                      >
                        <span>
                          {f.name}
                          {f.status && f.status !== "ACTIVE" && <span className="ml-2 text-xs">({f.status.toLowerCase()})</span>}
                        </span>
                        {checked && <Check size={15} className="text-gold" />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-text-secondary">
                  {inspection.formsError
                    ? `Não foi possível listar os formulários: ${inspection.formsError}`
                    : "Nenhum formulário encontrado nesta Página."}{" "}
                  Você pode informar o ID do formulário abaixo.
                </p>
              )}
              <Input
                value={manualForms}
                onChange={(e) => setManualForms(e.target.value)}
                placeholder="IDs de formulários (opcional, separados por vírgula)"
              />
            </div>
          )}

          {pageId && (
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Conta de anúncios (opcional, só informativo)
              </label>
              {inspection.adAccounts.length > 0 ? (
                <select
                  value={adAccountId}
                  onChange={(e) => setAdAccountId(e.target.value)}
                  className="w-full rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 px-4 py-2.5 text-sm text-foreground"
                >
                  <option value="">Não informar</option>
                  {inspection.adAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.id})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)} placeholder="ID da conta" />
                  <Input value={adAccountName} onChange={(e) => setAdAccountName(e.target.value)} placeholder="Nome da conta" />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {inspection && pageId && (
          <Button onClick={save} disabled={loading !== null}>
            {loading === "save" ? "Validando na Meta..." : "Salvar conexão"}
          </Button>
        )}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={loading !== null}>
            Cancelar
          </Button>
        )}
      </div>
    </Card>
  );
}

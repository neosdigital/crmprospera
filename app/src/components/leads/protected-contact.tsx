import { Lock } from "lucide-react";

/**
 * Exibe um telefone/e-mail. Quando `isProtected`, o valor JÁ chegou mascarado do servidor
 * (ver lib/lead-privacy.ts) — o cadeado + desfoque só deixam evidente que é um contato
 * protegido de lead de outro corretor. Sem hooks: funciona em Server e Client Components.
 */
export function ProtectedContact({ value, isProtected }: { value: string | null; isProtected: boolean }) {
  if (!value) return null;
  if (!isProtected) return <>{value}</>;

  return (
    <span className="inline-flex items-center gap-1" title="Contato protegido: este lead não está na sua carteira">
      <Lock size={11} className="shrink-0 text-gold" aria-hidden />
      <span className="select-none blur-[1.5px]" aria-label="Contato protegido">
        {value}
      </span>
      <span className="rounded bg-gold-soft px-1 text-[10px] font-medium uppercase tracking-wide text-gold">protegido</span>
    </span>
  );
}

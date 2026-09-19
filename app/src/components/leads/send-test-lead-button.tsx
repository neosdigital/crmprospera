"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { poster, FetchError } from "@/lib/fetcher";
import { generateFakeLead } from "@/lib/fake-lead";
import { Button } from "@/components/ui/button";

export function SendTestLeadButton({ onSent }: { onSent?: () => void }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);

  async function handleClick() {
    setSending(true);
    setErrorMsg(null);
    try {
      const fake = generateFakeLead();
      await poster("/api/leads", fake);
      setLastSent(fake.name);
      onSent?.();
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof FetchError ? err.message : "Não foi possível criar o lead de teste.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button type="button" variant="secondary" onClick={handleClick} disabled={sending}>
        <Sparkles size={16} />
        {sending ? "Enviando..." : "Enviar Lead Fictício"}
      </Button>
      {lastSent && !errorMsg && (
        <p className="text-xs text-text-secondary">
          Lead &quot;{lastSent}&quot; criado e distribuído.
        </p>
      )}
      {errorMsg && <p className="text-xs text-danger">{errorMsg}</p>}
    </div>
  );
}

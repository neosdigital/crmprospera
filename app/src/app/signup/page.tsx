"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { poster, FetchError } from "@/lib/fetcher";

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    try {
      await poster("/api/onboarding", {
        organizationName: formData.get("organizationName"),
        ownerName: formData.get("ownerName"),
        email: formData.get("email"),
        password: formData.get("password"),
      });
      setDone(true);
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      setError(err instanceof FetchError ? err.message : "Não foi possível criar sua conta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gold text-lg font-bold text-[#191919]">
            CP
          </div>
          <h1 className="text-xl font-semibold text-foreground">Criar sua imobiliária</h1>
          <p className="mt-1 text-sm text-text-secondary">Comece a distribuir leads automaticamente</p>
        </div>

        {done ? (
          <div className="rounded-2xl border border-[color:var(--color-border-gold)] bg-surface p-6 text-center">
            <p className="text-foreground">Conta criada! Redirecionando para o login...</p>
          </div>
        ) : (
          <form
            action={handleSubmit}
            className="space-y-4 rounded-2xl border border-[color:var(--color-border-gold)] bg-surface p-6"
          >
            {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">Nome da imobiliária</label>
              <Input name="organizationName" required placeholder="Imobiliária Exemplo" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">Seu nome</label>
              <Input name="ownerName" required placeholder="Seu nome completo" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">Email</label>
              <Input name="email" type="email" required placeholder="voce@empresa.com" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">Senha</label>
              <Input name="password" type="password" required minLength={8} placeholder="Mínimo 8 caracteres" />
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Criando..." : "Criar minha conta"}
            </Button>

            <p className="text-center text-xs text-text-secondary">
              Já tem uma conta?{" "}
              <Link href="/login" className="text-gold underline">
                Entrar
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

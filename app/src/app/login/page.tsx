import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Email ou senha incorretos.",
  Default: "Não foi possível entrar. Tente novamente.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirect: false,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect(`/login?error=${err.type}`);
      }
      throw err;
    }
    // Middleware redireciona /login -> /dashboard ou /broker/dashboard conforme o role.
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Image
            src="/logo-prospera.png"
            alt="Próspera"
            width={2170}
            height={725}
            priority
            className="mx-auto mb-4 h-auto w-full max-w-[220px]"
          />
          <p className="mt-1 text-sm text-text-secondary">Entre com sua conta para continuar</p>
        </div>

        <form action={login} className="space-y-4 rounded-2xl border border-[color:var(--color-border-gold)] bg-surface p-6">
          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default}
            </p>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Email</label>
            <Input type="email" name="email" placeholder="voce@empresa.com" required autoFocus />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Senha</label>
            <Input type="password" name="password" placeholder="••••••••" required />
          </div>

          <Button type="submit" className="w-full">
            Entrar
          </Button>

          <p className="text-center text-xs text-text-secondary">
            Sua imobiliária ainda não tem conta?{" "}
            <Link href="/signup" className="text-gold underline">
              Criar conta
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

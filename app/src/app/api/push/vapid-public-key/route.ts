import { NextResponse } from "next/server";

/**
 * Chave pública VAPID — não é segredo (é literalmente "pública"), por isso essa rota não
 * exige autenticação. Servida em runtime em vez de embutida via NEXT_PUBLIC_ pra permitir
 * trocar a chave sem precisar de rebuild.
 */
export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json({ error: "Push não configurado no servidor." }, { status: 503 });
  }
  return NextResponse.json({ publicKey });
}

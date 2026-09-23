import { NextResponse } from "next/server";
import { prisma, encryptSecret, decryptSecret } from "@crm/db";

/**
 * Diagnóstico de configuração — nunca retorna valores de segredo, só booleanos/tamanhos.
 * Protegido pelo mesmo CRON_SECRET usado no fallback do worker, para não expor publicamente
 * quais variáveis estão configuradas. Existe só para depurar deploys (ex.: confirmar que
 * META_TOKEN_ENCRYPTION_KEY está igual entre app e worker sem precisar acessar o painel).
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const env = {
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    AUTH_SECRET: Boolean(process.env.AUTH_SECRET),
    AUTH_URL: process.env.AUTH_URL ?? null,
    META_APP_SECRET: Boolean(process.env.META_APP_SECRET),
    META_VERIFY_TOKEN: Boolean(process.env.META_VERIFY_TOKEN),
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION ?? null,
    META_TOKEN_ENCRYPTION_KEY_present: Boolean(process.env.META_TOKEN_ENCRYPTION_KEY),
    META_TOKEN_ENCRYPTION_KEY_length: process.env.META_TOKEN_ENCRYPTION_KEY?.length ?? 0,
    CRON_SECRET: Boolean(process.env.CRON_SECRET),
    VAPID_PUBLIC_KEY: Boolean(process.env.VAPID_PUBLIC_KEY),
    VAPID_PRIVATE_KEY: Boolean(process.env.VAPID_PRIVATE_KEY),
    VAPID_SUBJECT: process.env.VAPID_SUBJECT ?? null,
  };

  let databaseOk = false;
  let databaseError: string | null = null;
  try {
    await prisma.organization.count();
    databaseOk = true;
  } catch (error) {
    databaseError = (error as Error).message;
  }

  let encryptionRoundTripOk = false;
  let encryptionError: string | null = null;
  try {
    const encrypted = encryptSecret("diagnostics-check");
    const decrypted = decryptSecret(encrypted);
    encryptionRoundTripOk = decrypted === "diagnostics-check";
  } catch (error) {
    encryptionError = (error as Error).message;
  }

  return NextResponse.json({
    ok: databaseOk && encryptionRoundTripOk,
    env,
    database: { ok: databaseOk, error: databaseError },
    encryption: { ok: encryptionRoundTripOk, error: encryptionError },
    deployment: { vercelUrl: process.env.VERCEL_URL ?? null, env_name: process.env.VERCEL_ENV ?? null },
  });
}

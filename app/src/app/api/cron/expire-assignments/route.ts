import { NextResponse } from "next/server";
import { findExpiredAssignmentIds, expireAndRotate } from "@crm/db";

/**
 * Endpoint de fallback/teste manual do mesmo processo executado pelo worker do Railway
 * (worker/src/index.ts). Protegido por CRON_SECRET — não expõe nada sensível, mas evita
 * que qualquer pessoa dispare expirações manualmente. Útil em desenvolvimento local para
 * forçar uma varredura sem precisar rodar `npm run worker` separadamente.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const ids = await findExpiredAssignmentIds(100);
  const results = [];
  for (const id of ids) {
    const result = await expireAndRotate(id);
    results.push({ id, ...result });
  }

  return NextResponse.json({ processed: results.length, results });
}

/**
 * Restaura um backup gerado por scripts/backup.ts num banco Postgres VAZIO.
 *
 * Proteções (para nunca sobrescrever um CRM em uso):
 * - O banco de destino precisa ser informado explicitamente com --target (nunca usa a
 *   DATABASE_URL do .env).
 * - Recusa restaurar se QUALQUER tabela do destino já tiver registros.
 * - Tudo numa única transação: ou entra o backup inteiro, ou nada.
 * - Ao final confere a contagem de linhas de cada tabela contra o backup.
 *
 * Passo a passo:
 *   1. Criar um banco novo (ex.: novo Postgres no Railway) e copiar a URL dele.
 *   2. Criar as tabelas:  DATABASE_URL="<url-do-banco-novo>" npx prisma migrate deploy   (em packages/db)
 *   3. Restaurar:         npx tsx scripts/restore-backup.ts --file "<backup.json.gz>" --target "<url-do-banco-novo>"
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import zlib from "zlib";

type Backup = {
  format: string;
  formatVersion: number;
  createdAt: string;
  migrations: string[];
  tables: Record<string, { rowCount: number; rows: Record<string, unknown>[] }>;
};

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Bytes salvos como { $bytes: base64 } voltam ao formato que o Postgres entende (\x...). */
function reviveRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === "object" && "$bytes" in (v as object)) {
      out[k] = "\\x" + Buffer.from(String((v as { $bytes: string }).$bytes), "base64").toString("hex");
    } else out[k] = v;
  }
  return out;
}

async function main() {
  const file = arg("file");
  const target = arg("target");
  if (!file || !target) {
    console.error('Uso: npx tsx scripts/restore-backup.ts --file "<backup.json.gz>" --target "<postgres-url-do-banco-NOVO>"');
    process.exit(1);
  }

  const backup = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as Backup;
  if (backup.format !== "crm-prospera-backup") throw new Error("Arquivo não é um backup do CRM Próspera.");
  console.log(`Backup de ${backup.createdAt} — ${Object.keys(backup.tables).length} tabelas`);

  const prisma = new PrismaClient({ datasources: { db: { url: target } } });
  try {
    // Os dados têm acentos e emojis: um banco criado com codificação diferente de UTF8
    // (ex.: WIN1252, padrão do Postgres no Windows) recusaria parte deles no meio do caminho.
    const [{ server_encoding }] = await prisma.$queryRaw<{ server_encoding: string }[]>`SHOW server_encoding`;
    if (server_encoding.toUpperCase() !== "UTF8") {
      throw new Error(`O banco de destino usa a codificação ${server_encoding}; crie-o com UTF8 (ex.: CREATE DATABASE ... ENCODING 'UTF8').`);
    }

    const existing = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    const existingNames = new Set(existing.map((t) => t.table_name));
    const toRestore = Object.keys(backup.tables).filter((t) => t !== "_prisma_migrations");

    const missing = toRestore.filter((t) => !existingNames.has(t));
    if (missing.length > 0) {
      throw new Error(`O banco de destino não tem as tabelas: ${missing.join(", ")}. Rode antes "npx prisma migrate deploy" nele.`);
    }
    for (const t of toRestore) {
      const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*)::bigint AS count FROM public.${quoteIdent(t)}`);
      if (Number(count) > 0) {
        throw new Error(`RECUSADO: a tabela "${t}" do destino já tem ${count} registros. A restauração só roda num banco vazio.`);
      }
    }

    // Ordem de inserção respeitando as chaves estrangeiras (pais antes dos filhos).
    const fks = await prisma.$queryRaw<{ child: string; parent: string }[]>`
      SELECT tc.table_name AS child, ccu.table_name AS parent
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `;
    const order: string[] = [];
    const pending = new Set(toRestore);
    while (pending.size > 0) {
      const ready = [...pending].filter((t) =>
        fks.filter((f) => f.child === t && f.parent !== t).every((f) => !pending.has(f.parent))
      );
      if (ready.length === 0) throw new Error(`Dependência circular entre: ${[...pending].join(", ")}`);
      ready.sort().forEach((t) => {
        order.push(t);
        pending.delete(t);
      });
    }

    await prisma.$transaction(
      async (tx) => {
        for (const table of order) {
          const rows = backup.tables[table].rows.map(reviveRow);
          for (let i = 0; i < rows.length; i += 500) {
            const chunk = JSON.stringify(rows.slice(i, i + 500));
            await tx.$executeRawUnsafe(
              `INSERT INTO public.${quoteIdent(table)} SELECT * FROM json_populate_recordset(NULL::public.${quoteIdent(table)}, $1::json)`,
              chunk
            );
          }
          console.log(`  ${table}: ${rows.length}`);
        }
      },
      { timeout: 600_000, maxWait: 30_000 }
    );

    for (const table of order) {
      const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*)::bigint AS count FROM public.${quoteIdent(table)}`);
      if (Number(count) !== backup.tables[table].rowCount) {
        throw new Error(`Conferência falhou em ${table}: ${count} no banco x ${backup.tables[table].rowCount} no backup`);
      }
    }
    console.log("Restauração concluída e conferida: todas as tabelas com a mesma quantidade de registros do backup.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

/**
 * Backup por organização (Configurações → Backup): exportar e IMPORTAR SOMANDO.
 *
 * Regras da importação (pedido explícito: nunca perder nem duplicar nada):
 * - Só insere o que NÃO existe. Registro que já existe fica exatamente como está — nada é
 *   apagado, zerado ou sobrescrito (INSERT ... ON CONFLICT DO NOTHING: vale para o id e para
 *   qualquer outra chave única — e-mail do usuário, lead da Meta, tentativa da roleta etc.).
 * - Só mexe na organização de quem importa: linhas de outras organizações que estejam no
 *   arquivo (o backup diário completo tem todas) são ignoradas, e um registro só é inserido
 *   se tudo que ele referencia (corretor, lead, usuário...) existir nesta mesma organização.
 * - Tudo numa transação única: ou entra o lote inteiro, ou nada. A prévia roda a mesma
 *   importação e desfaz no final, então os números mostrados são os reais.
 *
 * Tabelas, colunas e chaves estrangeiras são lidas do catálogo do Postgres — tabelas novas
 * do CRM passam a ser exportadas/importadas sem precisar mexer aqui.
 */

export const BACKUP_FORMAT = "crm-prospera-backup";
export const BACKUP_FORMAT_VERSION = 1;

type Tx = Prisma.TransactionClient;
type Row = Record<string, unknown>;

export type BackupFile = {
  format: string;
  formatVersion: number;
  createdAt: string;
  scope?: "database" | "organization";
  organizationId?: string;
  migrations?: string[];
  tables: Record<string, { rowCount: number; rows: Row[] }>;
};

export type MergeTableResult = { table: string; inFile: number; added: number; skipped: number };
export type MergeResult = { applied: boolean; tables: MergeTableResult[]; added: number; ignoredTables: string[] };

const ORG_TABLE = "organizations";
const ORG_COLUMN = "organization_id";
const IGNORED_TABLES = new Set(["_prisma_migrations"]);

function q(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

export function backupJsonReplacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString("base64") };
  if (value instanceof Prisma.Decimal) return value.toString();
  return value;
}

/** Bytes salvos como { $bytes: base64 } voltam ao formato que o Postgres entende (\x...). */
function reviveRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v && typeof v === "object" && "$bytes" in (v as object)
      ? "\\x" + Buffer.from(String((v as { $bytes: string }).$bytes), "base64").toString("hex")
      : v;
  }
  return out;
}

type Schema = {
  order: string[];
  columns: Map<string, Set<string>>;
  fks: { child: string; childCol: string; parent: string; parentCol: string }[];
};

/** Tabelas (pais antes dos filhos), colunas e chaves estrangeiras do schema public. */
async function readSchema(tx: Tx): Promise<Schema> {
  const cols = await tx.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
  `;
  const columns = new Map<string, Set<string>>();
  for (const c of cols) {
    if (IGNORED_TABLES.has(c.table_name)) continue;
    if (!columns.has(c.table_name)) columns.set(c.table_name, new Set());
    columns.get(c.table_name)!.add(c.column_name);
  }

  const fks = await tx.$queryRaw<{ child: string; childCol: string; parent: string; parentCol: string }[]>`
    SELECT cl.relname AS child, att.attname AS "childCol", pcl.relname AS parent, patt.attname AS "parentCol"
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    JOIN pg_class pcl ON pcl.oid = c.confrelid
    JOIN LATERAL unnest(c.conkey, c.confkey) AS k(child_attnum, parent_attnum) ON true
    JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.child_attnum
    JOIN pg_attribute patt ON patt.attrelid = c.confrelid AND patt.attnum = k.parent_attnum
    WHERE c.contype = 'f' AND n.nspname = 'public'
  `;

  const order: string[] = [];
  const pending = new Set(columns.keys());
  while (pending.size > 0) {
    const ready = [...pending].filter((t) =>
      fks.filter((f) => f.child === t && f.parent !== t).every((f) => !pending.has(f.parent))
    );
    if (ready.length === 0) throw new Error(`Dependência circular entre tabelas: ${[...pending].join(", ")}`);
    ready.sort().forEach((t) => {
      order.push(t);
      pending.delete(t);
    });
  }
  return { order, columns, fks };
}

/**
 * Como saber se uma linha pertence à organização: tabela com organization_id → pela coluna;
 * "organizations" → pelo id; tabela sem a coluna (ex.: lead_note_revisions) → por uma chave
 * estrangeira para uma tabela da organização. Sem nenhum desses vínculos: não é dado de
 * organização (fica de fora).
 */
function tenantLink(schema: Schema, table: string) {
  if (table === ORG_TABLE) return { kind: "self" as const };
  if (schema.columns.get(table)?.has(ORG_COLUMN)) return { kind: "column" as const };
  const viaFk = schema.fks.filter(
    (f) => f.child === table && f.parent !== table && (f.parent === ORG_TABLE || schema.columns.get(f.parent)?.has(ORG_COLUMN))
  );
  return viaFk.length > 0 ? { kind: "fk" as const, fks: viaFk } : null;
}

/** Exporta SÓ a organização informada, no mesmo formato do backup diário (importável aqui). */
export async function exportOrganizationBackup(prisma: PrismaClient, organizationId: string): Promise<BackupFile> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const schema = await readSchema(tx);
      const tables: BackupFile["tables"] = {};
      for (const table of schema.order) {
        const link = tenantLink(schema, table);
        if (!link) continue;
        let rows: Row[];
        if (link.kind === "self") {
          rows = await tx.$queryRawUnsafe<Row[]>(`SELECT * FROM public.${q(table)} WHERE "id" = $1`, organizationId);
        } else if (link.kind === "column") {
          rows = await tx.$queryRawUnsafe<Row[]>(`SELECT * FROM public.${q(table)} WHERE ${q(ORG_COLUMN)} = $1`, organizationId);
        } else {
          const conditions = link.fks.map((f) =>
            f.parent === ORG_TABLE
              ? `t.${q(f.childCol)} = $1`
              : `EXISTS (SELECT 1 FROM public.${q(f.parent)} p WHERE p.${q(f.parentCol)} = t.${q(f.childCol)} AND p.${q(ORG_COLUMN)} = $1)`
          );
          rows = await tx.$queryRawUnsafe<Row[]>(`SELECT t.* FROM public.${q(table)} t WHERE ${conditions.join(" OR ")}`, organizationId);
        }
        tables[table] = { rowCount: rows.length, rows };
      }
      return {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        createdAt: new Date().toISOString(),
        scope: "organization",
        organizationId,
        tables,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000, maxWait: 15_000 }
  );
}

/** Confere se o conteúdo é mesmo um backup do CRM (mensagem de erro em português ou null). */
export function validateBackupFile(data: unknown): string | null {
  const b = data as Partial<BackupFile> | null;
  if (!b || typeof b !== "object" || b.format !== BACKUP_FORMAT) return "O arquivo não é um backup do CRM Próspera.";
  if (typeof b.formatVersion !== "number" || b.formatVersion > BACKUP_FORMAT_VERSION) {
    return "Este backup foi gerado por uma versão mais nova do CRM.";
  }
  if (!b.tables || typeof b.tables !== "object") return "O arquivo de backup está incompleto.";
  return null;
}

class RollbackPreview extends Error {
  constructor(public result: MergeResult) {
    super("preview");
  }
}

/**
 * Importa SOMANDO o backup na organização: insere só o que falta, nunca altera nem apaga.
 * `apply: false` = prévia (executa e desfaz, devolvendo o que seria adicionado).
 */
export async function mergeBackupIntoOrganization(
  prisma: PrismaClient,
  backup: BackupFile,
  organizationId: string,
  options: { apply: boolean }
): Promise<MergeResult> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const schema = await readSchema(tx);
        const results: MergeTableResult[] = [];
        const keptIds = new Map<string, Set<unknown>>();
        const ignoredTables = Object.keys(backup.tables).filter((t) => !IGNORED_TABLES.has(t) && !schema.columns.has(t));

        for (const table of schema.order) {
          const link = tenantLink(schema, table);
          const fileRows = backup.tables[table]?.rows ?? [];
          if (!link || fileRows.length === 0) continue;

          // 1) Só linhas desta organização.
          const rows = fileRows.filter((r) => {
            if (link.kind === "self") return r.id === organizationId;
            if (link.kind === "column") return r[ORG_COLUMN] === organizationId;
            return link.fks.some((f) =>
              f.parent === ORG_TABLE ? r[f.childCol] === organizationId : keptIds.get(f.parent)?.has(r[f.childCol])
            );
          });
          keptIds.set(table, new Set(rows.map((r) => r.id)));
          if (rows.length === 0) continue;

          // 2) Cada referência precisa existir NESTA organização (ou ser nula).
          const fkConditions = schema.fks
            .filter((f) => f.child === table && f.parent !== table)
            .map((f) => {
              const sameOrg =
                f.parent === ORG_TABLE
                  ? ` AND p.${q(f.parentCol)} = $2`
                  : schema.columns.get(f.parent)?.has(ORG_COLUMN)
                    ? ` AND p.${q(ORG_COLUMN)} = $2`
                    : "";
              return `(r.${q(f.childCol)} IS NULL OR EXISTS (SELECT 1 FROM public.${q(f.parent)} p WHERE p.${q(f.parentCol)} = r.${q(f.childCol)}${sameOrg}))`;
            });
          const where = fkConditions.length > 0 ? `WHERE ${fkConditions.join(" AND ")}` : "";

          // 3) Insere só o que não existe: conflito em QUALQUER chave única = mantém o existente.
          let added = 0;
          for (let i = 0; i < rows.length; i += 500) {
            const chunk = JSON.stringify(rows.slice(i, i + 500).map(reviveRow), backupJsonReplacer);
            added += await tx.$executeRawUnsafe(
              `INSERT INTO public.${q(table)} SELECT r.* FROM json_populate_recordset(NULL::public.${q(table)}, $1::json) r ${where} ON CONFLICT DO NOTHING`,
              chunk,
              organizationId
            );
          }
          results.push({ table, inFile: rows.length, added, skipped: rows.length - added });
        }

        const result: MergeResult = {
          applied: options.apply,
          tables: results,
          added: results.reduce((s, r) => s + r.added, 0),
          ignoredTables,
        };
        if (!options.apply) throw new RollbackPreview(result);
        return result;
      },
      { timeout: 120_000, maxWait: 15_000 }
    );
  } catch (error) {
    if (error instanceof RollbackPreview) return error.result;
    throw error;
  }
}

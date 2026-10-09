/**
 * Backup completo do CRM — TODAS as tabelas e registros do banco, num arquivo .json.gz.
 *
 * Segurança (nada no CRM é alterado):
 * - Lê o banco numa transação READ ONLY + REPEATABLE READ: o Postgres recusa qualquer
 *   escrita nela, e todas as tabelas saem do mesmo instante (foto consistente).
 * - Descobre as tabelas pelo catálogo do Postgres: tabelas criadas no futuro entram sozinhas.
 * - Depois de gravar, relê o arquivo e confere a contagem de linhas de cada tabela; só então
 *   o backup é dado como válido e copiado para os destinos (pasta local + Google Drive).
 * - A limpeza de backups antigos só apaga arquivos com o nome exato deste backup.
 *
 * Uso:  npm run backup   (na raiz do projeto)
 * Destinos: BACKUP_DIRS (separados por ";") ou, por padrão, Documentos\Backups CRM Prospera
 * e G:\Meu Drive\Backups CRM Prospera (Google Drive para computador sincroniza sozinho).
 * Restaurar: ver scripts/restore-backup.ts.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";

const FORMAT = "crm-prospera-backup";
const FORMAT_VERSION = 1;
const FILE_PATTERN = /^crm-prospera-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.json\.gz$/;
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS ?? 90);
const MIN_KEEP_FILES = 30;

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function defaultDirs(): string[] {
  if (process.env.BACKUP_DIRS) return process.env.BACKUP_DIRS.split(";").map((d) => d.trim()).filter(Boolean);
  const dirs = [path.join(os.homedir(), "Documents", "Backups CRM Prospera")];
  for (const drive of ["G:\\Meu Drive", "G:\\My Drive"]) {
    if (fs.existsSync(drive)) {
      dirs.push(path.join(drive, "Backups CRM Prospera"));
      break;
    }
  }
  return dirs;
}

/** "2026-10-05_23-30" no horário de Brasília (UTC-3 fixo). */
function brasiliaStamp(date: Date) {
  const wall = new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString();
  return `${wall.slice(0, 10)}_${wall.slice(11, 13)}-${wall.slice(14, 16)}`;
}

function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

function jsonReplacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString("base64") };
  if (value instanceof Prisma.Decimal) return value.toString();
  return value;
}

function sha256(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

type TableDump = { rowCount: number; rows: Record<string, unknown>[] };

async function dumpDatabase(prisma: PrismaClient) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const tables = await tx.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `;
      const dump: Record<string, TableDump> = {};
      for (const { table_name } of tables) {
        const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM public.${quoteIdent(table_name)}`);
        dump[table_name] = { rowCount: rows.length, rows };
      }
      return dump;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 300_000, maxWait: 30_000 }
  );
}

function cleanupOldBackups(dir: string, log: (msg: string) => void) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => FILE_PATTERN.test(f))
    .sort()
    .reverse(); // mais novo primeiro (nome tem data/hora)
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  files.slice(MIN_KEEP_FILES).forEach((file) => {
    const full = path.join(dir, file);
    if (fs.statSync(full).mtimeMs < cutoff) {
      fs.unlinkSync(full);
      if (fs.existsSync(`${full}.sha256`)) fs.unlinkSync(`${full}.sha256`);
      log(`removido backup antigo: ${file}`);
    }
  });
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  loadEnvFile(path.join(repoRoot, "app", ".env.local"));
  loadEnvFile(path.join(repoRoot, "worker", ".env"));
  const url = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não encontrada (app/.env.local ou variável de ambiente).");

  const dirs = defaultDirs();
  const logDir = dirs[0];
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "backup.log");
  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(logFile, line + os.EOL);
  };

  const startedAt = new Date();
  const fileName = `crm-prospera-backup-${brasiliaStamp(startedAt)}.json.gz`;
  log(`iniciando backup -> ${fileName}`);

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const tables = await dumpDatabase(prisma);
    const migrations = (tables._prisma_migrations?.rows ?? [])
      .filter((r) => r.finished_at)
      .map((r) => String(r.migration_name))
      .sort();

    const payload = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      createdAt: startedAt.toISOString(),
      database: new URL(url).host,
      migrations,
      tables,
    };
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload, jsonReplacer), "utf8"), { level: 9 });

    // Conferência: o arquivo relido precisa ter exatamente as mesmas tabelas e contagens.
    const reread = JSON.parse(zlib.gunzipSync(gz).toString("utf8")) as typeof payload;
    for (const [name, t] of Object.entries(tables)) {
      const back = reread.tables[name];
      if (!back || back.rowCount !== t.rowCount || back.rows.length !== t.rowCount) {
        throw new Error(`conferência falhou na tabela ${name}`);
      }
    }

    const hash = sha256(gz);
    const summary = Object.entries(tables)
      .map(([name, t]) => `${name}=${t.rowCount}`)
      .join(" ");

    let saved = 0;
    for (const dir of dirs) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const target = path.join(dir, fileName);
        const partial = `${target}.partial`;
        fs.writeFileSync(partial, gz);
        if (sha256(fs.readFileSync(partial)) !== hash) throw new Error("cópia gravada difere do original");
        fs.renameSync(partial, target);
        fs.writeFileSync(`${target}.sha256`, `${hash}  ${fileName}${os.EOL}`);
        fs.writeFileSync(
          path.join(dir, "ULTIMO-BACKUP.txt"),
          [
            `Último backup: ${fileName}`,
            `Data: ${startedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (horário de Brasília)`,
            `Tamanho: ${(gz.length / 1024).toFixed(0)} KB`,
            `SHA-256: ${hash}`,
            `Registros por tabela: ${summary}`,
            `Status: OK (arquivo relido e conferido)`,
          ].join(os.EOL) + os.EOL
        );
        const errorFile = path.join(dir, "BACKUP-COM-ERRO.txt");
        if (fs.existsSync(errorFile)) fs.unlinkSync(errorFile);
        cleanupOldBackups(dir, log);
        saved += 1;
        log(`salvo em ${dir}`);
      } catch (error) {
        log(`ERRO ao salvar em ${dir}: ${String(error)}`);
      }
    }
    if (saved === 0) throw new Error("não foi possível salvar o backup em nenhum destino");

    log(`backup OK (${(gz.length / 1024).toFixed(0)} KB, ${Object.keys(tables).length} tabelas) - ${summary}`);
  } catch (error) {
    log(`BACKUP FALHOU: ${String(error)}`);
    for (const dir of dirs) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, "BACKUP-COM-ERRO.txt"),
          `O backup de ${startedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} FALHOU:${os.EOL}${String(error)}${os.EOL}Veja backup.log.${os.EOL}`
        );
      } catch {
        // destino indisponível — já registrado no log
      }
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();

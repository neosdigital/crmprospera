import { NextResponse } from "next/server";
import zlib from "zlib";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { prisma, mergeBackupIntoOrganization, validateBackupFile, type BackupFile } from "@crm/db";

export const maxDuration = 60;

// A Vercel recusa corpos acima de ~4,5 MB; o backup de uma organização hoje tem poucas centenas de KB.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Importa um backup SOMANDO na organização de quem está logado (ver backup-merge.ts):
 * só adiciona o que falta, nunca apaga nem sobrescreve, nunca duplica, ignora dados de
 * outras organizações. `mode=preview` executa e desfaz (mostra o que seria adicionado);
 * `mode=apply` grava. Exclusivo de dono/admin.
 */
export async function POST(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const form = await req.formData();
    const file = form.get("file");
    const mode = form.get("mode") === "apply" ? "apply" : "preview";
    if (!(file instanceof Blob)) throw new ApiError(400, "Selecione o arquivo de backup.");
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "O arquivo passa de 4 MB.");

    const raw = Buffer.from(await file.arrayBuffer());
    let backup: unknown;
    try {
      const isGzip = raw[0] === 0x1f && raw[1] === 0x8b;
      backup = JSON.parse((isGzip ? zlib.gunzipSync(raw) : raw).toString("utf8"));
    } catch {
      throw new ApiError(400, "Não foi possível ler o arquivo. Envie o .json.gz gerado pelo backup do CRM.");
    }
    const invalid = validateBackupFile(backup);
    if (invalid) throw new ApiError(400, invalid);

    const result = await mergeBackupIntoOrganization(prisma, backup as BackupFile, session.user.organizationId, {
      apply: mode === "apply",
    });
    if (mode === "apply") {
      console.info("[backup] importação aplicada", {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        added: result.added,
      });
    }
    return NextResponse.json({ ...result, backupCreatedAt: (backup as BackupFile).createdAt });
  } catch (error) {
    return jsonError(error);
  }
}

import zlib from "zlib";
import { requireSession, jsonError } from "@/lib/api";
import { prisma, exportOrganizationBackup, backupJsonReplacer } from "@crm/db";
import { formatBrasilia } from "@/lib/brasilia-time";

export const maxDuration = 60;

/**
 * "Baixar backup agora" (Configurações): todos os registros DESTA organização num
 * .json.gz — mesmo formato do backup diário, então pode ser importado de volta aqui.
 * Só leitura (transação READ ONLY). Exclusivo de dono/admin.
 */
export async function GET() {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: session.user.organizationId },
      select: { slug: true },
    });
    const backup = await exportOrganizationBackup(prisma, session.user.organizationId);
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(backup, backupJsonReplacer), "utf8"), { level: 9 });
    const stamp = formatBrasilia(new Date(), "yyyy-MM-dd_HH-mm");

    return new Response(new Uint8Array(gz), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="crm-prospera-${org.slug}-backup-${stamp}.json.gz"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

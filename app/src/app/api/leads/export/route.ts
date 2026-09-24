import { requireSession, jsonError } from "@/lib/api";
import { scopedDb } from "@/lib/tenant-db";

function csvEscape(value: unknown) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const db = scopedDb(session.user.organizationId);

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const brokerId = url.searchParams.get("brokerId");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (brokerId) where.currentBrokerId = brokerId;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }

    const leads = await db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { currentBroker: { select: { displayName: true } } },
    });

    const header = ["Nome", "Telefone", "Email", "Campanha", "Corretor", "Status", "Observação", "Recebido em"];
    const rows = leads.map((l) =>
      [l.name, l.phone, l.email, l.campaignName, l.currentBroker?.displayName, l.status, l.notes, l.createdAt.toISOString()]
        .map(csvEscape)
        .join(",")
    );
    const csv = [header.join(","), ...rows].join("\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads.csv"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

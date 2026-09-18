import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { prisma } from "@crm/db";

const bodySchema = z.object({ direction: z.enum(["up", "down"]) });

/** Troca a posição do corretor com o vizinho imediato na roleta (reordenação manual). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const { id } = await params;
    const { direction } = bodySchema.parse(await req.json());

    await prisma.$transaction(async (tx) => {
      const current = await tx.broker.findFirst({
        where: { id, organizationId: session.user.organizationId },
      });
      if (!current) throw new ApiError(404, "Corretor não encontrado.");

      const neighbor = await tx.broker.findFirst({
        where: {
          organizationId: session.user.organizationId,
          rotationPosition: direction === "up" ? { lt: current.rotationPosition } : { gt: current.rotationPosition },
        },
        orderBy: { rotationPosition: direction === "up" ? "desc" : "asc" },
      });
      if (!neighbor) return; // já está na ponta, nada a fazer

      const tempPosition = 1_000_000 + current.rotationPosition;
      await tx.broker.update({ where: { id: current.id }, data: { rotationPosition: tempPosition } });
      await tx.broker.update({ where: { id: neighbor.id }, data: { rotationPosition: current.rotationPosition } });
      await tx.broker.update({ where: { id: current.id }, data: { rotationPosition: neighbor.rotationPosition } });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

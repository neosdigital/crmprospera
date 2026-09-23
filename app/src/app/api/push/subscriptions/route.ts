import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { prisma } from "@crm/db";

/** Lista os dispositivos com push ativado do usuário logado (tela de configurações). */
export async function GET() {
  try {
    const session = await requireSession();
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, userAgent: true, createdAt: true, lastSuccessAt: true, lastErrorAt: true, lastError: true },
    });
    return NextResponse.json({ subscriptions });
  } catch (error) {
    return jsonError(error);
  }
}

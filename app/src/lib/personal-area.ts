import { NextResponse } from "next/server";
import { prisma, hasPersonalAccess, PersonalAreaError } from "@crm/db";
import { requireSession, ApiError, jsonError } from "@/lib/api";
import { brasiliaDayRange } from "@/lib/brasilia-time";

/**
 * Autorização da Área do Corretor (módulo isolado). Tudo é decidido no servidor, a partir da
 * sessão e do banco — nunca de um id de corretor mandado pelo navegador:
 * - Corretor: precisa estar com o acesso liberado (lido do banco a cada requisição, então
 *   desativar vale na hora) e só enxerga a PRÓPRIA carteira particular.
 * - Dono/Admin: enxerga as carteiras particulares de todos os corretores da própria
 *   imobiliária (e só dela).
 */
export type PersonalViewer = {
  userId: string;
  organizationId: string;
  isAdmin: boolean;
  /** Corretor logado (null para dono/admin). */
  brokerId: string | null;
};

export async function requirePersonalViewer(): Promise<PersonalViewer> {
  const session = await requireSession();
  const { id, organizationId, role, brokerId } = session.user;
  if (role === "OWNER" || role === "ADMIN") return { userId: id, organizationId, isAdmin: true, brokerId: null };
  if (role === "BROKER" && brokerId && (await hasPersonalAccess(brokerId))) {
    return { userId: id, organizationId, isAdmin: false, brokerId };
  }
  throw new ApiError(403, "Você não tem acesso à Área do Corretor.");
}

export async function requirePersonalBroker(): Promise<PersonalViewer & { brokerId: string }> {
  const viewer = await requirePersonalViewer();
  if (viewer.isAdmin || !viewer.brokerId) {
    throw new ApiError(403, "A conexão com o Meta é feita pelo próprio corretor, na Área do Corretor dele.");
  }
  return viewer as PersonalViewer & { brokerId: string };
}

export async function requirePersonalAdmin(): Promise<PersonalViewer> {
  const viewer = await requirePersonalViewer();
  if (!viewer.isAdmin) throw new ApiError(403, "Apenas o dono ou administradores podem fazer isso.");
  return viewer;
}

/**
 * De qual corretor são os dados pedidos. Corretor: sempre ele mesmo (o parâmetro é ignorado).
 * Admin: o corretor informado, conferindo que é da mesma imobiliária; sem parâmetro, todos.
 */
export async function resolveBrokerScope(viewer: PersonalViewer, requestedBrokerId: string | null): Promise<string | null> {
  if (!viewer.isAdmin) return viewer.brokerId;
  if (!requestedBrokerId) return null;
  const broker = await prisma.broker.findFirst({
    where: { id: requestedBrokerId, organizationId: viewer.organizationId },
    select: { id: true },
  });
  if (!broker) throw new ApiError(404, "Corretor não encontrado.");
  return broker.id;
}

/** Filtro base (empresa + dono) para qualquer consulta de lead particular. */
export function personalLeadScope(viewer: PersonalViewer, brokerId: string | null) {
  return {
    organizationId: viewer.organizationId,
    ...(brokerId ? { brokerId } : {}),
  };
}

export async function loadPersonalLeadForViewer(viewer: PersonalViewer, leadId: string) {
  const lead = await prisma.personalLead.findFirst({
    where: { id: leadId, organizationId: viewer.organizationId, ...(viewer.isAdmin ? {} : { brokerId: viewer.brokerId! }) },
  });
  if (!lead) throw new ApiError(404, "Lead não encontrado.");
  return lead;
}

export async function loadConnectionForViewer(viewer: PersonalViewer, connectionId: string) {
  const connection = await prisma.brokerMetaConnection.findFirst({
    where: {
      id: connectionId,
      organizationId: viewer.organizationId,
      ...(viewer.isAdmin ? {} : { brokerId: viewer.brokerId! }),
    },
  });
  if (!connection) throw new ApiError(404, "Integração não encontrada.");
  return connection;
}

/** Período "De/Até" (YYYY-MM-DD, horário de Brasília) → filtro de createdAt. */
export function periodFilter(from: string | null, to: string | null) {
  const start = from ? brasiliaDayRange(from)?.start : undefined;
  const end = to ? brasiliaDayRange(to)?.end : undefined;
  if (!start && !end) return {};
  return { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } };
}

/** Dados de conexão seguros para o navegador: nunca inclui o token. */
export function publicConnection(c: {
  id: string;
  brokerId: string;
  name: string;
  accountOwnerName: string | null;
  pageId: string;
  pageName: string | null;
  adAccountId: string | null;
  adAccountName: string | null;
  status: string;
  isActive: boolean;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  lastLeadAt: Date | null;
  createdAt: Date;
  forms?: { formId: string; formName: string | null; isActive: boolean; lastPolledAt: Date | null }[];
}) {
  return {
    id: c.id,
    brokerId: c.brokerId,
    name: c.name,
    accountOwnerName: c.accountOwnerName,
    pageId: c.pageId,
    pageName: c.pageName,
    adAccountId: c.adAccountId,
    adAccountName: c.adAccountName,
    status: c.isActive ? c.status : "DISCONNECTED",
    isActive: c.isActive,
    lastSyncAt: c.lastSyncAt,
    lastSyncError: c.lastSyncError,
    lastLeadAt: c.lastLeadAt,
    createdAt: c.createdAt,
    forms: (c.forms ?? [])
      .filter((f) => f.isActive)
      .map((f) => ({ formId: f.formId, formName: f.formName, lastPolledAt: f.lastPolledAt })),
  };
}

/** Igual ao jsonError, mas também converte os erros de negócio do módulo. */
export function personalJsonError(error: unknown) {
  if (error instanceof PersonalAreaError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return jsonError(error);
}

/**
 * Usado pelos layouts para decidir se mostram o item de menu. Nunca lança: se a migração da
 * Área do Corretor ainda não foi aplicada no banco, simplesmente não mostra o item (e nada
 * mais do CRM é afetado).
 */
export async function brokerHasPersonalAreaSafe(brokerId: string | null | undefined): Promise<boolean> {
  if (!brokerId) return false;
  try {
    return await hasPersonalAccess(brokerId);
  } catch {
    return false;
  }
}

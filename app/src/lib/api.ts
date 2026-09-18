import { auth } from "@/auth";
import type { Role } from "@crm/db";
import { ApiError } from "@/lib/errors";

export { ApiError, jsonError } from "@/lib/errors";

/** Garante que existe uma sessão válida e, opcionalmente, que o role está entre os permitidos. */
export async function requireSession(allowedRoles?: Role[]) {
  const session = await auth();
  if (!session?.user) {
    throw new ApiError(401, "Sua sessão expirou. Faça login novamente.");
  }
  if (allowedRoles && !allowedRoles.includes(session.user.role)) {
    throw new ApiError(403, "Você não tem permissão para acessar este recurso.");
  }
  return session;
}

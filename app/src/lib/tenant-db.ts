import { prisma } from "@crm/db";

/**
 * Modelos que carregam organization_id e precisam de isolação multi-tenant.
 * Qualquer modelo fora desta lista passa pelo client sem alteração.
 */
const TENANT_MODELS = new Set([
  "Lead",
  "LeadAssignment",
  "Broker",
  "User",
  "RotationState",
  "MetaIntegration",
  "AuditLog",
]);

const READ_MANY_OPS = new Set(["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy"]);
const READ_UNIQUE_OPS = new Set(["findUnique", "findUniqueOrThrow"]);
const WRITE_WHERE_OPS = new Set(["update", "delete", "updateMany", "deleteMany"]);

/**
 * Camada central de acesso a dados multi-tenant.
 *
 * Nunca confiamos apenas no frontend para esconder dados de outras organizações
 * (seção 23/24 do escopo): toda rota de API que lida com dados de uma organização
 * deve usar `scopedDb(session.user.organizationId)` em vez do client Prisma cru.
 * A extensão injeta automaticamente `organization_id` vindo da SESSÃO AUTENTICADA
 * (nunca de um parâmetro de URL/body) em toda leitura e escrita dos modelos tenant-scoped.
 *
 * Exceção deliberada: o motor de rotação/expiração (src/lib/rotation.ts) é código de
 * sistema que opera com o client Prisma puro e SQL bruto para locks (`SELECT ... FOR UPDATE`),
 * sempre recebendo organizationId explicitamente como parâmetro — extensões de client não
 * interceptam $queryRaw, então esse caminho crítico é escrito e revisado manualmente em vez
 * de depender desta camada.
 */
export function scopedDb(organizationId: string) {
  if (!organizationId) {
    throw new Error("scopedDb requer um organizationId válido");
  }

  return prisma.$extends({
    name: `tenant-scope:${organizationId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) {
            return query(args);
          }

          const a = args as Record<string, unknown>;

          if (READ_MANY_OPS.has(operation) || WRITE_WHERE_OPS.has(operation)) {
            a.where = { ...(a.where as object | undefined), organizationId };
            return query(a);
          }

          if (READ_UNIQUE_OPS.has(operation)) {
            const result = await query(a);
            if (result && (result as Record<string, unknown>).organizationId !== organizationId) {
              return null;
            }
            return result;
          }

          if (operation === "create") {
            a.data = { ...(a.data as object | undefined), organizationId };
            return query(a);
          }

          if (operation === "createMany" && Array.isArray(a.data)) {
            a.data = (a.data as object[]).map((d) => ({ ...d, organizationId }));
            return query(a);
          }

          return query(a);
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof scopedDb>;

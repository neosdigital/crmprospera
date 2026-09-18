import type { NextAuthConfig } from "next-auth";
import type { Role } from "@crm/db";

type SessionUserFields = { role: Role; organizationId: string; brokerId: string | null };

/**
 * Config "edge-safe": sem o Credentials provider (que usa Prisma/bcrypt, incompatíveis
 * com o runtime de Edge do middleware). O provider completo é adicionado em src/auth.ts,
 * usado apenas em Server Components/Route Handlers (runtime Node.js).
 */
export default {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const u = user as unknown as SessionUserFields;
        token.role = u.role;
        token.organizationId = u.organizationId;
        token.brokerId = u.brokerId;
      }
      return token;
    },
    session({ session, token }) {
      const t = token as unknown as SessionUserFields & { sub: string };
      session.user.id = t.sub;
      session.user.role = t.role;
      session.user.organizationId = t.organizationId;
      session.user.brokerId = t.brokerId;
      return session;
    },
  },
} satisfies NextAuthConfig;

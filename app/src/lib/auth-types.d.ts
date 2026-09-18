import { Role } from "@crm/db";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role: Role;
    organizationId: string;
    brokerId: string | null;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
      organizationId: string;
      brokerId: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Role;
    organizationId: string;
    brokerId: string | null;
  }
}

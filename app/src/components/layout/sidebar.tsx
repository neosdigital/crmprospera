import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/layout/sign-out-button";

export type SidebarItem = { href: string; label: string; icon: ReactNode };

export function Sidebar({
  items,
  orgName,
  userName,
}: {
  items: SidebarItem[];
  orgName: string;
  userName: string;
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-[color:var(--color-border-gold)] bg-sidebar px-4 py-6 md:flex">
      <div className="mb-8 px-2">
        <Image
          src="/logo-prospera.png"
          alt="Próspera"
          width={2170}
          height={725}
          priority
          className="h-auto w-full max-w-[168px]"
        />
      </div>

      <nav className="flex-1 space-y-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto border-t border-[color:var(--color-border-gold)] pt-4">
        <p className="truncate px-3 text-sm font-medium text-foreground">{userName}</p>
        <p className="truncate px-3 text-xs text-text-secondary">{orgName}</p>
        <SignOutButton />
      </div>
    </aside>
  );
}

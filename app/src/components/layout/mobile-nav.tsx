"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import type { SidebarItem } from "@/components/layout/sidebar";

export function MobileNav({ items, orgName }: { items: SidebarItem[]; orgName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-between border-b border-[color:var(--color-border-gold)] bg-sidebar px-4 py-3 md:hidden">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold text-xs font-bold text-[#191919]">
          CP
        </div>
        <span className="text-sm font-medium text-foreground">{orgName}</span>
      </div>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg p-2 text-foreground hover:bg-surface-2"
        aria-label="Abrir menu"
      >
        <Menu size={22} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div className="w-72 max-w-[80vw] bg-sidebar px-4 py-6">
            <div className="mb-6 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Menu</span>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-2" aria-label="Fechar menu">
                <X size={20} />
              </button>
            </div>
            <nav className="space-y-1">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text-secondary hover:bg-surface-2 hover:text-foreground"
                >
                  <item.icon size={18} />
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <button
            className="flex-1 bg-black/60"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          />
        </div>
      )}
    </div>
  );
}

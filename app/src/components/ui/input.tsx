import { clsx } from "clsx";
import type { InputHTMLAttributes } from "react";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "w-full rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 px-4 py-2.5 text-sm text-foreground placeholder:text-text-secondary outline-none transition-colors focus:border-[color:var(--color-border-gold-strong)]",
        className
      )}
      {...props}
    />
  );
}

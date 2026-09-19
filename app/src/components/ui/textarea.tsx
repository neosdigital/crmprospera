import { clsx } from "clsx";
import type { TextareaHTMLAttributes } from "react";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(
        "w-full rounded-xl border border-[color:var(--color-border-gold)] bg-surface-2 px-4 py-2.5 text-sm text-foreground placeholder:text-text-secondary outline-none transition-colors focus:border-[color:var(--color-border-gold-strong)]",
        className
      )}
      {...props}
    />
  );
}

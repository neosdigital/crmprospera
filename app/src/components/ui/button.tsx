import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-gold text-[#191919] hover:brightness-95 font-semibold",
  secondary:
    "bg-surface-2 text-foreground border border-[color:var(--color-border-gold)] hover:border-[color:var(--color-border-gold-strong)]",
  ghost: "text-text-secondary hover:text-foreground",
  danger: "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20",
};

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        className
      )}
      {...props}
    />
  );
}

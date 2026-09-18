import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

type Tone = "neutral" | "gold" | "success" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-text-secondary",
  gold: "bg-gold-soft text-gold",
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        TONES[tone],
        className
      )}
      {...props}
    />
  );
}

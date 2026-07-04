import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Uppercase-label / value row used across every record page. The
 * label typography is frozen (`text-[11px] uppercase tracking-wider
 * text-muted-foreground`) so pages stop drifting between `text-xs
 * uppercase tracking-wide` and other near-identical variants.
 *
 * Column layout is `[minmax(120px,1fr)_2fr]` — narrow label column
 * on the left, ~2x value column on the right. Wraps to a stacked
 * layout on very narrow viewports via the parent grid.
 */
interface DetailRowProps {
  label: ReactNode;
  value: ReactNode;
  /** Monospace typography on the value (batch codes, waybill refs). */
  mono?: boolean;
  /** Set to `2` to span both columns in a two-column grid parent
   *  (long freeform values like addresses / notes). */
  span?: 1 | 2;
  className?: string;
}

export function DetailRow({
  label,
  value,
  mono,
  span,
  className,
}: DetailRowProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(120px,1fr)_2fr] items-baseline gap-2",
        span === 2 && "sm:col-span-2",
        className,
      )}
    >
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-sm text-foreground",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </span>
    </div>
  );
}

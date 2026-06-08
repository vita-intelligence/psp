import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModuleTileProps {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Optional one-line caption rendered under the label — use for a
   *  count, a status hint, or a "Coming soon" tag. */
  caption?: string;
  /** Render in muted/disabled state without preventing navigation —
   *  used for modules that aren't shipped yet but the user can still
   *  visit a placeholder page. */
  muted?: boolean;
}

/**
 * Big square module launcher tile, MRPEasy-style. Circular icon on
 * top, label centred below. The whole card is the link so it has a
 * large touch target — important for tablet operators on the
 * warehouse floor.
 */
export function ModuleTile({
  href,
  label,
  Icon,
  caption,
  muted,
}: ModuleTileProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex aspect-square flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-border/60 bg-card p-4 text-center shadow-sm transition-all",
        "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        muted && "opacity-70",
      )}
    >
      <span
        className={cn(
          "inline-flex size-14 items-center justify-center rounded-full transition-colors sm:size-16",
          muted
            ? "bg-muted text-muted-foreground"
            : "bg-primary/10 text-primary group-hover:bg-primary/15",
        )}
      >
        <Icon className="size-7 sm:size-8" />
      </span>

      <div className="space-y-0.5">
        <p className="text-sm font-semibold tracking-tight sm:text-base">
          {label}
        </p>
        {caption && (
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {caption}
          </p>
        )}
      </div>
    </Link>
  );
}

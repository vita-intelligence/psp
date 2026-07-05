import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Canonical empty-state block. Drop into DataTable's `emptyState`
 * slot, or render standalone. Structure: rounded muted circle around
 * a size-6 icon, a `text-sm font-semibold` title, a `text-xs` body,
 * and an optional CTA row underneath.
 *
 * Modelled on the projects list empty state (the audit's canonical
 * exemplar). Sizing is deliberate — big enough to feel intentional,
 * small enough to fit inside a DataTable frame.
 */
interface EmptyStateProps {
  icon?: ComponentType<{ className?: string }>;
  title: ReactNode;
  body?: ReactNode;
  cta?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  cta,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
          <Icon className="size-6 text-muted-foreground" />
        </div>
      )}
      <p className="text-sm font-semibold">{title}</p>
      {body && (
        <p className="max-w-md text-xs text-muted-foreground">{body}</p>
      )}
      {cta && <div className="mt-1">{cta}</div>}
    </div>
  );
}

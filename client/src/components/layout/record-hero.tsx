import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Canonical "record hero" — the top-of-page block for a specific record
 * (vendor, PO, customer, sales order, invoice, pricelist, return). Renders
 * the record's code + status chips above the record's display name, all
 * inside a bordered card so it reads as a first-class heading distinct
 * from list-page headers.
 *
 * Mirrors PageHeader for consistency, but the hero pattern is opinionated
 * enough (code chip + status pill above the title) to deserve its own
 * primitive.
 */
interface RecordHeroProps {
  icon: ComponentType<{ className?: string }>;
  code: ReactNode;
  chips?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  className?: string;
}

export function RecordHero({
  icon: Icon,
  code,
  chips,
  title,
  subtitle,
  actions,
  backHref,
  backLabel,
  className,
}: RecordHeroProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {backHref && backLabel && (
        <div>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="-ml-2 h-8 px-2 text-muted-foreground"
          >
            <Link href={backHref}>
              <ChevronLeft className="mr-1 size-4" />
              {backLabel}
            </Link>
          </Button>
        </div>
      )}

      <header className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Icon className="size-4 text-muted-foreground" />
              <span className="font-mono text-xs font-semibold text-muted-foreground">
                {code}
              </span>
              {chips}
            </div>
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <div className="text-sm text-muted-foreground">{subtitle}</div>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </header>
    </div>
  );
}

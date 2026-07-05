import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Canonical page header used by every list + detail page in PSP.
 *
 * Two sizings — `list` (bigger, no back-link) and `detail` (one step
 * down, with a "back to parent" ghost button). The class strings are
 * frozen so the codebase stops drifting into ad-hoc `text-2xl` /
 * `text-3xl` variants; if a new size ever becomes necessary, it lands
 * here so every page picks it up in one go.
 *
 * Copy the pattern from `/shipments/page.tsx` (list) or
 * `/shipments/[uuid]/page.tsx` (detail) — those two were the audit
 * "canonical" exemplars.
 */
interface PageHeaderProps {
  /** Optional lucide icon rendered inline with the title. */
  icon?: ComponentType<{ className?: string }>;
  /** The h1 text. */
  title: ReactNode;
  /** Optional muted description underneath. */
  description?: ReactNode;
  /** Sizing profile.
   *  - `list` — top-of-list pages (bigger h1 + icon).
   *  - `detail` — record pages (one step smaller, subordinate to
   *    the list header the operator navigated FROM). */
  size?: "list" | "detail";
  /** Optional back-link. Rendered as a ghost Button with ChevronLeft
   *  above the title. Use `href` for a plain Link; pass a full node
   *  (e.g. a breadcrumb block) via `backSlot` for anything richer. */
  backHref?: string;
  backLabel?: string;
  backSlot?: ReactNode;
  /** Right-aligned actions slot (e.g. `<Button>New</Button>`). */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  icon: Icon,
  title,
  description,
  size = "list",
  backHref,
  backLabel = "Back",
  backSlot,
  actions,
  className,
}: PageHeaderProps) {
  const titleClass =
    size === "list"
      ? "text-3xl font-semibold tracking-tight sm:text-4xl"
      : "text-2xl font-semibold tracking-tight sm:text-3xl";
  const iconClass =
    size === "list"
      ? "size-7 text-brand sm:size-8"
      : "size-6 text-brand sm:size-7";

  const back =
    backSlot ??
    (backHref ? (
      <div className="text-sm">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 px-2">
          <Link href={backHref}>
            <ChevronLeft className="mr-1 size-4" />
            {backLabel}
          </Link>
        </Button>
      </div>
    ) : null);

  return (
    <header className={cn("space-y-1.5", className)}>
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <h1 className={cn("flex items-center gap-3", titleClass)}>
            {Icon && <Icon className={iconClass} />}
            {title}
          </h1>
          {description && (
            <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}

import Link from "next/link";
import { ArrowRight, GitFork } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCompanyNumber } from "@/lib/format/company";
import type { CompanyDefaults } from "@/lib/types";
import type {
  ManufacturingOrder,
  ManufacturingOrderRelation,
  ManufacturingOrderStatus,
} from "@/lib/production/types";

interface Props {
  mo: ManufacturingOrder;
  company: CompanyDefaults;
}

const STATUS_TONE: Record<
  ManufacturingOrderStatus,
  { bg: string; text: string; dot: string; label: string }
> = {
  draft: {
    bg: "bg-muted/70",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground/40",
    label: "Draft",
  },
  approved: {
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    text: "text-indigo-700 dark:text-indigo-300",
    dot: "bg-indigo-500",
    label: "Approved",
  },
  in_progress: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-800 dark:text-amber-300",
    dot: "bg-amber-500 animate-pulse",
    label: "In progress",
  },
  completed: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    label: "Completed",
  },
  cancelled: {
    bg: "bg-destructive/10",
    text: "text-destructive",
    dot: "bg-destructive",
    label: "Cancelled",
  },
};

/**
 * "Sub-production" panel — renders the child MO tree (auto-spawned
 * to produce semi-finished inputs this MO consumes). Hidden when
 * the MO has no children.
 */
export function MOSubProduction({ mo, company }: Props) {
  if (!mo.children || mo.children.length === 0) return null;

  const openChildren = mo.children.filter(
    (c) => c.status !== "completed" && c.status !== "cancelled",
  );

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <GitFork className="size-3.5 text-muted-foreground" />
          Sub-production
        </h2>
        <p className="text-[11px] text-muted-foreground">
          {openChildren.length === 0
            ? "All sub-MOs done — this run is ready to start."
            : `${openChildren.length} of ${mo.children.length} sub-MO${mo.children.length === 1 ? "" : "s"} still open.`}
        </p>
      </header>

      <ul className="divide-y divide-border/60">
        {mo.children.map((child) => (
          <ChildRow key={child.id} child={child} company={company} />
        ))}
      </ul>

      {openChildren.length > 0 && (
        <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-50/40 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          This MO can&apos;t move to <span className="font-medium">In progress</span> until every sub-MO above is completed or cancelled.
        </p>
      )}
    </section>
  );
}

function ChildRow({
  child,
  company,
}: {
  child: ManufacturingOrderRelation;
  company: CompanyDefaults;
}) {
  const tone = STATUS_TONE[child.status];
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ring-border/60",
              tone.bg,
              tone.text,
            )}
          >
            <span className={cn("size-1.5 rounded-full", tone.dot)} />
            {tone.label}
          </span>
          <p className="truncate text-sm font-medium">
            {child.item?.name ?? "—"}
          </p>
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {child.code ?? `#${child.id}`} ·{" "}
          {formatCompanyNumber(child.quantity, company)} {child.item?.stock_uom?.symbol ?? ""}
        </p>
      </div>
      <Link
        href={`/production/manufacturing-orders/${child.uuid}`}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
      >
        Open
        <ArrowRight className="size-3" />
      </Link>
    </li>
  );
}

/**
 * Small breadcrumb shown on a child MO's detail page so the
 * operator sees "this run feeds <parent>".
 */
export function MOParentBreadcrumb({
  mo,
}: {
  mo: ManufacturingOrder;
}) {
  if (!mo.parent_mo) return null;
  return (
    <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs">
      <span className="text-muted-foreground">Part of </span>
      <Link
        href={`/production/manufacturing-orders/${mo.parent_mo.uuid}`}
        className="font-medium text-brand hover:underline"
      >
        {mo.parent_mo.code ?? `MO #${mo.parent_mo.id}`}
      </Link>
      {mo.parent_mo.item && (
        <span className="text-muted-foreground"> — {mo.parent_mo.item.name}</span>
      )}
    </div>
  );
}

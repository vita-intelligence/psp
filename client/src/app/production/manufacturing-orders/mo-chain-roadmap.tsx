import Link from "next/link";
import {
  ArrowDown,
  CalendarClock,
  Check,
  CircleAlert,
  ClipboardCheck,
  Factory,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCompanyNumber } from "@/lib/format/company";
import type { CompanyDefaults } from "@/lib/types";
import type {
  ManufacturingOrder,
  ManufacturingOrderChainNode,
  ManufacturingOrderStatus,
} from "@/lib/production/types";

interface Props {
  mo: ManufacturingOrder;
  company: CompanyDefaults;
}

const STATUS_STYLES: Record<
  ManufacturingOrderStatus,
  {
    border: string;
    bg: string;
    text: string;
    dot: string;
    label: string;
    icon: typeof Factory;
  }
> = {
  draft: {
    border: "border-border",
    bg: "bg-card",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground/50",
    label: "Draft",
    icon: Factory,
  },
  prepared: {
    border: "border-amber-300 dark:border-amber-800",
    bg: "bg-amber-50/60 dark:bg-amber-950/30",
    text: "text-amber-800 dark:text-amber-300",
    dot: "bg-amber-500",
    label: "Awaiting approval",
    icon: ClipboardCheck,
  },
  approved: {
    border: "border-indigo-300 dark:border-indigo-800",
    bg: "bg-indigo-50/60 dark:bg-indigo-950/30",
    text: "text-indigo-700 dark:text-indigo-300",
    dot: "bg-indigo-500",
    label: "Approved",
    icon: Factory,
  },
  scheduled: {
    border: "border-sky-300 dark:border-sky-800",
    bg: "bg-sky-50/60 dark:bg-sky-950/30",
    text: "text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
    label: "Scheduled",
    icon: CalendarClock,
  },
  in_progress: {
    border: "border-amber-300 dark:border-amber-800",
    bg: "bg-amber-50/60 dark:bg-amber-950/30",
    text: "text-amber-800 dark:text-amber-300",
    dot: "bg-amber-500 animate-pulse",
    label: "In progress",
    icon: Factory,
  },
  completed: {
    border: "border-emerald-300 dark:border-emerald-800",
    bg: "bg-emerald-50/60 dark:bg-emerald-950/30",
    text: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    label: "Completed",
    icon: Check,
  },
  cancelled: {
    border: "border-destructive/40",
    bg: "bg-destructive/[0.04]",
    text: "text-destructive",
    dot: "bg-destructive",
    label: "Cancelled",
    icon: CircleAlert,
  },
};

interface RowGroup {
  depth: number;
  nodes: ManufacturingOrderChainNode[];
}

/**
 * Vertical "production roadmap" — orders the chain bottom-up so the
 * earliest-produced semi-finished sits at the top and the FG bottle/
 * pouch sits at the bottom. Branching shows side-by-side cards at
 * the same depth. The current MO is highlighted.
 */
export function MOChainRoadmap({ mo, company }: Props) {
  if (!mo.chain || mo.chain.length === 0) return null;

  const groups = groupByProductionOrder(mo.chain);

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <MapPin className="size-3.5 text-muted-foreground" />
          Production roadmap
        </h2>
        <p className="text-[11px] text-muted-foreground">
          {groups.length} stage{groups.length === 1 ? "" : "s"} · earliest at the top
        </p>
      </header>

      <ol className="relative flex flex-col items-stretch gap-0">
        {groups.map((group, idx) => (
          <li key={group.depth} className="flex flex-col items-stretch">
            <div className="flex flex-wrap items-stretch justify-center gap-3">
              {group.nodes.map((node) => (
                <ChainCard
                  key={node.id}
                  node={node}
                  company={company}
                  isCurrent={node.id === mo.id}
                />
              ))}
            </div>
            {idx < groups.length - 1 && (
              <div className="my-2 flex justify-center text-muted-foreground/70">
                <ArrowDown className="size-4" />
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ChainCard({
  node,
  company,
  isCurrent,
}: {
  node: ManufacturingOrderChainNode;
  company: CompanyDefaults;
  isCurrent: boolean;
}) {
  const style = STATUS_STYLES[node.status];
  const Icon = style.icon;
  const uom = node.item?.stock_uom?.symbol ?? "";

  const inner = (
    <div
      className={cn(
        "group flex w-full max-w-md gap-3 rounded-lg border px-4 py-3 transition-shadow",
        style.border,
        style.bg,
        isCurrent
          ? "ring-2 ring-brand ring-offset-2 ring-offset-background"
          : "hover:shadow-sm",
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
          isCurrent ? "bg-brand text-white" : "bg-background ring-1 ring-border/60",
        )}
      >
        <Icon className={cn("size-3.5", !isCurrent && style.text)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="truncate text-sm font-medium">
            {node.item?.name ?? `MO #${node.id}`}
          </p>
          {isCurrent && (
            <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand">
              You are here
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
              style.bg,
              style.text,
              "ring-1 ring-inset ring-border/40",
            )}
          >
            <span className={cn("size-1.5 rounded-full", style.dot)} />
            {style.label}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {formatCompanyNumber(node.quantity, company)} {uom} · {node.code ?? `#${node.id}`}
          </span>
        </div>
      </div>
    </div>
  );

  if (isCurrent) return inner;

  return (
    <Link
      href={`/production/manufacturing-orders/${node.uuid}`}
      className="block focus:outline-none"
    >
      {inner}
    </Link>
  );
}

/** Order the chain so the deepest leaves (earliest production
 *  steps) sit first. Nodes at the same tree-depth become a row;
 *  groups stack top→bottom. */
function groupByProductionOrder(
  chain: ManufacturingOrderChainNode[],
): RowGroup[] {
  const byId = new Map(chain.map((n) => [n.id, n] as const));
  const depth = new Map<number, number>();

  function depthOf(node: ManufacturingOrderChainNode): number {
    if (depth.has(node.id)) return depth.get(node.id)!;
    if (!node.parent_mo_id) {
      depth.set(node.id, 0);
      return 0;
    }
    const parent = byId.get(node.parent_mo_id);
    if (!parent) {
      depth.set(node.id, 0);
      return 0;
    }
    const d = depthOf(parent) + 1;
    depth.set(node.id, d);
    return d;
  }

  chain.forEach(depthOf);

  // Highest depth (leaf — earliest produced) first.
  const maxDepth = Math.max(...Array.from(depth.values()));

  const groups: RowGroup[] = [];
  for (let d = maxDepth; d >= 0; d--) {
    const nodes = chain
      .filter((n) => depth.get(n.id) === d)
      .sort((a, b) => a.id - b.id);
    if (nodes.length > 0) {
      groups.push({ depth: d, nodes });
    }
  }
  return groups;
}

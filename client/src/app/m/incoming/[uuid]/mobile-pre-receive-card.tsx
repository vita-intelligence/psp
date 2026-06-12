"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  PackageCheck,
  PlayCircle,
  Snowflake,
  Truck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import { createDraftAction } from "@/lib/goods-in/actions";
import type { Inspection } from "@/lib/goods-in/types";
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderLineItemSummary,
} from "@/lib/types";

interface Props {
  purchaseOrder: PurchaseOrder;
  /** Most-recent non-terminal inspection on this PO. When present, the
   *  CTA jumps straight to the wizard instead of creating a new draft. */
  openInspection: Inspection | null;
}

/**
 * Mobile "what to expect" card for a PO that's about to be received.
 *
 * Layout: vendor header + delivery badge, one row per PO line with
 * vendor part no + expected qty + compliance chips, big sticky CTA
 * at the bottom. Read-only — the realtime collab rule carves out
 * detail pages.
 */
export function MobilePreReceiveCard({
  purchaseOrder: po,
  openInspection,
}: Props) {
  const router = useRouter();
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const todayIso = useMemo(() => isoToday(), []);
  const badge = useMemo(
    () =>
      po.expected_delivery_date
        ? computeBadge(po.expected_delivery_date, todayIso)
        : null,
    [po.expected_delivery_date, todayIso],
  );

  function startReceiving() {
    if (pending) return;

    // Resume an existing draft / awaiting-QC inspection if one's already
    // open — saves the operator from having to discard a teammate's
    // half-filled state.
    if (openInspection) {
      router.push(`/m/inspections/${openInspection.uuid}`);
      return;
    }

    startTransition(async () => {
      const result = await createDraftAction(po.uuid, {
        delivery_date: po.expected_delivery_date ?? todayIso,
      });
      if (result.ok) {
        router.push(`/m/inspections/${result.inspection.uuid}`);
      } else {
        setErrorDetail(result.detail);
        setErrorCode(result.code);
      }
    });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center justify-between gap-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
          >
            <Link href="/m/incoming" aria-label="Back to expected deliveries">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight">
              Pre-receive checklist
            </h1>
            <p className="truncate text-[11px] text-muted-foreground">
              Cross-check against vendor&apos;s packing slip
            </p>
          </div>
          <Button asChild variant="ghost" size="sm" aria-label="Cancel">
            <Link href="/m/incoming">
              <X className="size-4" />
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 space-y-3 px-3 py-3 pb-28">
        {errorDetail && (
          <ErrorBanner
            tone="destructive"
            detail={errorDetail}
            code={errorCode ?? undefined}
          />
        )}

        {/* PO summary card */}
        <section className="rounded-xl border border-border/60 bg-card px-3 py-3">
          <div className="flex items-start gap-2">
            <Truck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-1.5">
              {badge && (
                <span
                  className={cn(
                    "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    badge.className,
                  )}
                >
                  {badge.label}
                </span>
              )}
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="font-mono text-xs font-semibold text-muted-foreground">
                  {po.code ?? `#${po.id}`}
                </span>
                <span className="truncate text-sm font-semibold">
                  {po.vendor?.name ?? "Unknown vendor"}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {po.lines.length}{" "}
                {po.lines.length === 1 ? "line" : "lines"} expected ·{" "}
                {po.default_warehouse?.name ?? "no default site"}
              </p>
              {openInspection && (
                <p className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                  <ClipboardCheck className="size-2.5" />
                  Inspection {openInspection.status === "draft"
                    ? "in progress"
                    : "awaiting QC"}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Line-by-line preview */}
        <section className="space-y-2">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Expected lines
          </h2>
          {po.lines.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
              This PO has no lines yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {po.lines.map((line) => (
                <PreReceiveLineRow key={line.uuid} line={line} />
              ))}
            </ul>
          )}
        </section>
      </main>

      {/* Sticky CTA bar */}
      <footer className="sticky bottom-0 z-20 border-t border-border/60 bg-background/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="outline"
            size="lg"
            className="flex-1 text-xs"
          >
            <Link href="/m/incoming">Cancel</Link>
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={startReceiving}
            disabled={pending}
            className="flex-[2] gap-1.5 text-sm font-semibold"
          >
            <PlayCircle className="size-4" />
            {pending
              ? "Opening…"
              : openInspection
                ? "Resume inspection"
                : "Start receiving"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

function PreReceiveLineRow({ line }: { line: PurchaseOrderLine }) {
  const item = line.item;
  const uomSymbol = item?.stock_uom?.symbol ?? item?.stock_uom?.code ?? null;
  const chips = computeComplianceChips(item);

  return (
    <li className="rounded-xl border border-border/60 bg-card px-3 py-3">
      <div className="flex items-start gap-2">
        <PackageCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="space-y-0.5">
            <p className="truncate text-sm font-medium">
              {item?.name ?? "Unknown item"}
            </p>
            {line.vendor_part_no && (
              <p className="font-mono text-[11px] text-muted-foreground">
                {line.vendor_part_no}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <span className="font-mono font-semibold">
              {formatQty(line.qty_ordered)}
              {uomSymbol ? ` ${uomSymbol}` : ""}
            </span>
            <span className="text-muted-foreground">expected</span>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {chips.map((chip) => (
                <span
                  key={chip.key}
                  title={chip.title}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    chip.className,
                  )}
                >
                  {chip.Icon ? <chip.Icon className="size-2.5" /> : null}
                  {chip.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

interface ComplianceChip {
  key: string;
  label: string;
  title?: string;
  className: string;
  Icon?: typeof AlertTriangle;
}

function computeComplianceChips(
  item: PurchaseOrderLineItemSummary | null,
): ComplianceChip[] {
  if (!item) return [];
  const chips: ComplianceChip[] = [];

  // Compliance status. `ready_for_use` → quiet green; `draft` → amber
  // so QC knows the item itself hasn't been finalised yet.
  if (item.compliance_status === "draft") {
    chips.push({
      key: "compliance_draft",
      label: "Compliance pending",
      title: "Item not finalised — flag to QC",
      className:
        "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      Icon: FileWarning,
    });
  } else {
    chips.push({
      key: "compliance_ready",
      label: "Compliant",
      className:
        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      Icon: CheckCircle2,
    });
  }

  const tags = Array.isArray(item.storage_tags) ? item.storage_tags : [];

  if (tags.some((t) => t === "requires_coa" || t === "requires_certificate")) {
    chips.push({
      key: "coa",
      label: "CoA on arrival",
      title:
        "Vendor must provide a Certificate of Analysis with this delivery",
      className:
        "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      Icon: FileWarning,
    });
  }

  if (
    tags.some(
      (t) => t === "allergen" || (typeof t === "string" && t.startsWith("allergen_")),
    )
  ) {
    chips.push({
      key: "allergen",
      label: "Allergen — segregate",
      title:
        "Contains a regulated allergen — keep separated from non-allergen stock",
      className: "bg-red-500/15 text-red-700 dark:text-red-300",
      Icon: AlertTriangle,
    });
  }

  // Cold-chain: defensive lookup on the attributes bag. Some items
  // carry the flag, some don't — treat any truthy value as cold-chain.
  const attrs = item.attributes ?? {};
  if (
    "requires_cold_chain" in attrs &&
    Boolean(
      (attrs as Record<string, unknown>)["requires_cold_chain"],
    )
  ) {
    chips.push({
      key: "cold_chain",
      label: "Cold chain",
      title:
        "Item must stay refrigerated — check vehicle temperature on arrival",
      className: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
      Icon: Snowflake,
    });
  }

  return chips;
}

function formatQty(qty: string): string {
  const n = Number(qty);
  if (!Number.isFinite(n)) return qty;
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function isoToday(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

interface PreReceiveBadge {
  label: string;
  className: string;
}

function computeBadge(expectedIso: string, todayIso: string): PreReceiveBadge {
  if (expectedIso < todayIso) {
    return {
      label: "Overdue",
      className: "bg-red-500/15 text-red-700 dark:text-red-300",
    };
  }
  if (expectedIso === todayIso) {
    return {
      label: "Expected today",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    };
  }
  // Anything in the future renders the date — keep it short for narrow
  // phones.
  const dt = new Date(expectedIso);
  const weekday = dt.toLocaleDateString(undefined, { weekday: "short" });
  const day = dt.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  return {
    label: `${weekday} ${day}`,
    className: "bg-muted text-foreground/70",
  };
}

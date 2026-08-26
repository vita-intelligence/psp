"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Coins,
  FileWarning,
  Mail,
  MapPin,
  PackageCheck,
  PlayCircle,
  Plus,
  Snowflake,
  StickyNote,
  Truck,
  User2,
  Warehouse,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  createDraftAction,
  deleteInspectionAction,
} from "@/lib/goods-in/actions";
import type { Inspection, InspectionStatus } from "@/lib/goods-in/types";
import {
  formatCompanyDate,
  formatCompanyMoney,
  formatCompanyNumber,
} from "@/lib/format/company";
import { useFormatPrefs } from "@/lib/format/company-prefs-context";
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderLineItemSummary,
} from "@/lib/types";

interface Props {
  purchaseOrder: PurchaseOrder;
  /** Every inspection ever logged against this PO, in server order.
   *  A PO can receive several physical deliveries — each has its own
   *  registration. Drives the deliveries hub + CTA branching. */
  inspections: Inspection[];
}

/**
 * Mobile per-PO deliveries hub. A single PO can arrive across several
 * physical shipments (staggered vendor dispatches); each shipment gets
 * its own goods-in inspection so the audit trail carries one signed
 * receipt per truck.
 *
 * Layout: vendor identity card + a "Deliveries" list (all inspections,
 * newest first) + line-level expectation preview + smart sticky CTA
 * that either resumes an in-flight draft or starts a fresh delivery.
 * Read-only page — no collab channel (per the PSP rule that carves out
 * detail pages).
 */
export function MobilePreReceiveCard({
  purchaseOrder: po,
  inspections,
}: Props) {
  const router = useRouter();
  const prefs = useFormatPrefs();
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmConcurrent, setConfirmConcurrent] = useState(false);
  // `pending` from useTransition doesn't flip synchronously — a fast
  // double-tap between the user's tap and React's next render would
  // fire two `createDraftAction`s and spawn two draft inspections. A
  // ref lock catches the double-tap before the transition even starts.
  const submittingRef = useRef(false);

  const todayIso = useMemo(() => isoToday(), []);
  const badge = useMemo(
    () =>
      po.expected_delivery_date
        ? computeBadge(po.expected_delivery_date, todayIso)
        : null,
    [po.expected_delivery_date, todayIso],
  );

  // Deliveries sorted newest first (server order isn't guaranteed to
  // match "most recent first" across draft/submitted/terminal buckets).
  // `delivery_date` is the operator-set truck-arrival date; falls back
  // to inserted_at (draft with no delivery date yet).
  const sortedDeliveries = useMemo(() => {
    const key = (i: Inspection): string =>
      i.delivery_date ?? i.inserted_at ?? "";
    return [...inspections].sort((a, b) => key(b).localeCompare(key(a)));
  }, [inspections]);

  // A single in-progress draft (there can be more than one in theory
  // — surface the newest so the CTA can resume it).
  const activeDraft = useMemo(
    () => sortedDeliveries.find((i) => i.status === "draft") ?? null,
    [sortedDeliveries],
  );
  const submittedCount = useMemo(
    () => sortedDeliveries.filter((i) => i.status === "submitted").length,
    [sortedDeliveries],
  );

  // Aggregate counters across all lines so the operator can spot
  // partial-receive state at a glance ("3 of 5 already in") without
  // scanning every row.
  const { totalReceived, totalOrdered, hasPartial, isFullyReceived } = useMemo(() => {
    let received = 0;
    let ordered = 0;
    for (const l of po.lines) {
      received += Number(l.qty_received) || 0;
      ordered += Number(l.qty_ordered) || 0;
    }
    return {
      totalReceived: received,
      totalOrdered: ordered,
      hasPartial: received > 0 && received < ordered,
      isFullyReceived: ordered > 0 && received >= ordered,
    };
  }, [po.lines]);

  // Which lines the operator sees on the truck. Pre-checked to every
  // remaining-qty line so the "whole truckload" case is one tap. This
  // selection ships to the wizard as a `?lines=` URL param so the
  // wizard's per-line walk skips straight to the picked items.
  //
  // Fully-received lines are NOT tickable at all (see PreReceiveLineRow's
  // `tickable` gate) — over-shipments are a rare, deliberate flow and
  // shouldn't happen by accident from a scrolling tap.
  const [selectedLineUuids, setSelectedLineUuids] = useState<Set<string>>(
    () => {
      const out = new Set<string>();
      for (const l of po.lines) {
        const ordered = Number(l.qty_ordered) || 0;
        const received = Number(l.qty_received) || 0;
        if (ordered - received > 0) out.add(l.uuid);
      }
      return out;
    },
  );

  // How many lines the operator can actually tick (i.e. lines with
  // remaining qty). Fully-received lines are shown for context but
  // don't count toward the "N of M ticked" counter.
  const tickableLineCount = useMemo(() => {
    let n = 0;
    for (const l of po.lines) {
      const ordered = Number(l.qty_ordered) || 0;
      const received = Number(l.qty_received) || 0;
      if (ordered - received > 0) n += 1;
    }
    return n;
  }, [po.lines]);

  function toggleLine(uuid: string, checked: boolean) {
    setSelectedLineUuids((prev) => {
      const next = new Set(prev);
      if (checked) next.add(uuid);
      else next.delete(uuid);
      return next;
    });
  }

  function createNewDelivery() {
    if (pending || submittingRef.current) return;
    submittingRef.current = true;
    setErrorDetail(null);
    setErrorCode(null);
    // Snapshot the current tick-list — the transition below is async
    // so we don't want a mid-flight setSelectedLineUuids to drift the
    // URL param.
    const selectionSnapshot = Array.from(selectedLineUuids);
    startTransition(async () => {
      try {
        const result = await createDraftAction(po.uuid, {
          // Deliveries typically arrive on the day the operator taps
          // this button, not on the PO's original ETA — a rescheduled
          // truck belongs to today, not to `expected_delivery_date`.
          delivery_date: todayIso,
        });
        if (result.ok) {
          // Ship the ticked-line uuids to the wizard so its per-line
          // walk skips straight to what's on the truck. Wizard's own
          // selector step remains as a safety net if the operator
          // needs to adjust mid-flow.
          const search =
            selectionSnapshot.length > 0
              ? `?lines=${encodeURIComponent(selectionSnapshot.join(","))}`
              : "";
          router.push(`/m/inspections/${result.inspection.uuid}${search}`);
        } else {
          setErrorDetail(result.detail);
          setErrorCode(result.code);
        }
      } finally {
        submittingRef.current = false;
      }
    });
  }

  function resumeDraft() {
    if (!activeDraft) return;
    router.push(`/m/inspections/${activeDraft.uuid}`);
  }

  function deleteDelivery(inspectionUuid: string, isDraft: boolean) {
    if (!isDraft) {
      // Guardrail on the client too — the BE rejects non-draft
      // deletes with :not_deletable, but flagging it here saves a
      // round-trip and shows a friendlier message.
      toast.error("Only draft deliveries can be deleted. Signed ones stay as audit records.");
      return;
    }
    if (!window.confirm("Delete this draft delivery? This can't be undone.")) return;
    startTransition(async () => {
      const res = await deleteInspectionAction(inspectionUuid);
      if (res.ok) {
        toast.success("Draft delivery deleted");
        router.refresh();
      } else {
        setErrorDetail(res.detail);
        setErrorCode(res.code);
      }
    });
  }

  // Primary CTA behaviour:
  //   - draft exists  → primary = "Resume {name}'s draft" (don't fork
  //     a peer's registration by mistake). A secondary "New delivery"
  //     button lives next to it, guarded by a confirm.
  //   - no draft      → primary = "New delivery" (one-tap create).
  //   - fully received AND no draft → primary still "New delivery" but
  //     with a warning ("this PO is already fully received"). Vendors
  //     do sometimes ship extra by mistake and the paperwork still
  //     needs a home.
  const primaryIsResume = Boolean(activeDraft);
  const draftOperatorName = activeDraft?.goods_in_operator?.name?.trim() || null;

  function onPrimaryTap() {
    if (pending) return;
    if (primaryIsResume) {
      resumeDraft();
      return;
    }
    if (isFullyReceived) {
      const ok = window.confirm(
        "This PO is already fully received. Log another delivery anyway?",
      );
      if (!ok) return;
    }
    createNewDelivery();
  }

  function onSecondaryNewDelivery() {
    // The primary is "Resume draft" and the operator tapped the
    // secondary "New delivery" — warn that they're forking off a
    // separate registration.
    setConfirmConcurrent(true);
  }

  function confirmNewDeliveryDespiteDraft() {
    setConfirmConcurrent(false);
    createNewDelivery();
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
              Deliveries
            </h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {inspections.length === 0
                ? "No deliveries logged yet"
                : `${inspections.length} logged${activeDraft ? " · 1 in progress" : submittedCount ? ` · ${submittedCount} awaiting QC` : ""}`}
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

        {/* Identity card — what the operator cross-checks against the
            packing slip first: PO #, vendor, delivery badge, status. */}
        <section className="rounded-xl border border-border/60 bg-card px-3 py-3">
          <div className="flex items-start gap-2">
            <Truck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
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
                <StatusBadge status={po.status} />
                {activeDraft && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                    <ClipboardCheck className="size-2.5" />
                    {draftOperatorName
                      ? `Draft by ${draftOperatorName}`
                      : "Draft in progress"}
                  </span>
                )}
              </div>
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
                {po.lines.length === 1 ? "line" : "lines"}
                {hasPartial && (
                  <>
                    {" · "}
                    {formatCompanyNumber(totalReceived, prefs)} of{" "}
                    {formatCompanyNumber(totalOrdered, prefs)} units already in
                  </>
                )}
              </p>
            </div>
          </div>
        </section>

        {/* Verification rows — the operator scans these against vendor
            paperwork: who, where, when, how much. */}
        <section className="divide-y divide-border/40 rounded-xl border border-border/60 bg-card">
          <DetailRow
            icon={Building2}
            label="Vendor"
            value={po.vendor?.name ?? "—"}
            sub={po.vendor?.code ?? undefined}
          />
          {po.vendor?.email && (
            <DetailRow
              icon={Mail}
              label="Vendor email"
              value={
                <a
                  href={`mailto:${po.vendor.email}`}
                  className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {po.vendor.email}
                </a>
              }
            />
          )}
          <DetailRow
            icon={Warehouse}
            label="Deliver to"
            value={po.default_warehouse?.name ?? "Site not set"}
            sub={po.delivery_address ?? undefined}
            subIcon={po.delivery_address ? MapPin : undefined}
          />
          <DetailRow
            icon={CalendarDays}
            label="Expected"
            value={
              po.expected_delivery_date
                ? formatCompanyDate(po.expected_delivery_date, prefs)
                : "Not set"
            }
          />
          {po.ordered_at && (
            <DetailRow
              icon={CalendarClock}
              label="Ordered"
              value={formatCompanyDate(po.ordered_at, prefs)}
              sub={po.ordered_by?.name ?? undefined}
              subIcon={po.ordered_by?.name ? User2 : undefined}
            />
          )}
          <DetailRow
            icon={Coins}
            label="PO total"
            value={formatCompanyMoney(po.grand_total, prefs, {
              currency_code: po.currency_code,
            })}
            sub={
              po.currency_code !== prefs.currency_code
                ? `in ${po.currency_code}`
                : undefined
            }
          />
          {po.notes && (
            <DetailRow
              icon={StickyNote}
              label="PO notes"
              value={
                <span className="whitespace-pre-wrap text-sm text-foreground/90">
                  {po.notes}
                </span>
              }
            />
          )}
        </section>

        {/* Deliveries hub — every inspection logged against this PO
            so the operator can spot in-flight drafts, awaiting-QC
            registrations, and past deliveries at a glance. Tapping a
            row opens the inspection wizard (edit if draft, view
            otherwise). */}
        <section className="space-y-2">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Deliveries
          </h2>
          {sortedDeliveries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
              None logged yet. Tap <span className="font-semibold text-foreground">New delivery</span> when the truck arrives.
            </div>
          ) : (
            <ul className="divide-y divide-border/40 rounded-xl border border-border/60 bg-card">
              {sortedDeliveries.map((insp) => (
                <DeliveryRow
                  key={insp.uuid}
                  inspection={insp}
                  onTap={() => router.push(`/m/inspections/${insp.uuid}`)}
                  onDelete={
                    insp.status === "draft"
                      ? () => deleteDelivery(insp.uuid, true)
                      : undefined
                  }
                  deleteBusy={pending}
                />
              ))}
            </ul>
          )}
        </section>

        {/* Tickable line list — "what did this truck bring?".
           *  Ticked lines flow through to the wizard as ?lines=…, so
           *  the per-line pack-detail walk skips straight to them.
           *  Rendered as checkboxes here (not just an informational
           *  preview) since the pick-what-arrived decision is the
           *  first thing the operator wants to make on this screen.
           *  Suppressed when a draft is active — the operator is
           *  resuming someone's registration, not creating a fresh
           *  one, so the tick-list would be misleading. They can
           *  adjust selection on the wizard's own selector step. */}
        {!activeDraft && (
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 px-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                What&apos;s on this truck?
              </h2>
              {po.lines.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {selectedLineUuids.size} of {tickableLineCount} ticked
                </span>
              )}
            </div>
            {po.lines.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
                This PO has no lines yet.
              </div>
            ) : (
              <ul className="space-y-2">
                {po.lines.map((line) => (
                  <PreReceiveLineRow
                    key={line.uuid}
                    line={line}
                    poWarehouseId={po.default_warehouse_id}
                    checked={selectedLineUuids.has(line.uuid)}
                    onToggle={(checked) => toggleLine(line.uuid, checked)}
                  />
                ))}
              </ul>
            )}
            <p className="px-1 text-[11px] text-muted-foreground">
              Untick items that aren&apos;t on this truck. They&apos;ll
              stay unreceived and show up on the next delivery.
            </p>
          </section>
        )}

        {/* Read-only preview when a draft is being resumed — the
           *  operator can still see what's expected on the PO
           *  without the tick UI muddying the intent. */}
        {activeDraft && (
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
                  <PreReceiveLineRow
                    key={line.uuid}
                    line={line}
                    poWarehouseId={po.default_warehouse_id}
                  />
                ))}
              </ul>
            )}
          </section>
        )}
      </main>

      {/* Sticky CTA bar
         *  - No draft → single big "New delivery" (creates + routes).
         *  - Draft   → "Resume {name}'s draft" primary + "New" secondary,
         *              secondary confirms first so two-truck cases don't
         *              accidentally fork a peer's registration. */}
      <footer className="sticky bottom-0 z-20 border-t border-border/60 bg-background/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-2">
          {primaryIsResume ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={onSecondaryNewDelivery}
                disabled={pending}
                className="flex-1 gap-1.5 text-xs font-medium"
              >
                <Plus className="size-4" />
                New delivery
              </Button>
              <Button
                type="button"
                size="lg"
                onClick={onPrimaryTap}
                disabled={pending}
                className="flex-[2] gap-1.5 text-sm font-semibold"
              >
                <PlayCircle className="size-4" />
                {pending
                  ? "Opening…"
                  : draftOperatorName
                    ? `Resume ${draftOperatorName}'s draft`
                    : "Resume draft"}
              </Button>
            </>
          ) : (
            <>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="flex-1 text-xs"
              >
                <Link href="/m/incoming">Back</Link>
              </Button>
              <Button
                type="button"
                size="lg"
                onClick={onPrimaryTap}
                disabled={pending || selectedLineUuids.size === 0}
                className="flex-[2] gap-1.5 text-sm font-semibold"
                title={
                  selectedLineUuids.size === 0
                    ? "Tick at least one item this truck brought"
                    : undefined
                }
              >
                <Plus className="size-4" />
                {pending
                  ? "Opening…"
                  : selectedLineUuids.size > 0
                    ? `New delivery — ${selectedLineUuids.size} ${selectedLineUuids.size === 1 ? "item" : "items"}`
                    : "New delivery"}
              </Button>
            </>
          )}
        </div>
      </footer>

      {/* Concurrent-draft confirm — surfaces only when the operator
          taps the secondary "New delivery" while a draft is open. */}
      {confirmConcurrent && (
        <ConcurrentDraftConfirm
          draftOperatorName={draftOperatorName}
          onCancel={() => setConfirmConcurrent(false)}
          onConfirm={confirmNewDeliveryDespiteDraft}
          pending={pending}
        />
      )}
    </div>
  );
}

/** Row in the deliveries hub — one per inspection on this PO. */
function DeliveryRow({
  inspection,
  onTap,
  onDelete,
  deleteBusy,
}: {
  inspection: Inspection;
  onTap: () => void;
  /** Provided only for draft rows — signed inspections can't be
   *  deleted (audit rule). Renders a small trash button on the right. */
  onDelete?: () => void;
  deleteBusy?: boolean;
}) {
  const prefs = useFormatPrefs();
  const dateLabel = inspection.delivery_date
    ? formatCompanyDate(inspection.delivery_date, prefs)
    : formatCompanyDate(inspection.inserted_at, prefs);
  const operatorName = inspection.goods_in_operator?.name?.trim() || null;
  const packsCount = inspection.items?.reduce((n, it) => n + (it.packs?.length ?? 0), 0) ?? 0;
  const linesCount = inspection.items?.length ?? 0;

  return (
    <li className="flex items-stretch">
      <button
        type="button"
        onClick={onTap}
        className="flex flex-1 items-center gap-3 px-3 py-3 text-left active:bg-muted"
      >
        <ClipboardCheck className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{dateLabel}</span>
            <InspectionStatusPill inspection={inspection} />
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {operatorName ? `by ${operatorName}` : "unassigned"}
            {linesCount > 0 && (
              <>
                {" · "}
                {linesCount} {linesCount === 1 ? "line" : "lines"}
                {packsCount > 0 && ` · ${packsCount} ${packsCount === 1 ? "pack" : "packs"}`}
              </>
            )}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          disabled={deleteBusy}
          className="flex shrink-0 items-center justify-center px-3 text-muted-foreground/60 hover:text-destructive active:bg-destructive/10 disabled:opacity-40"
          aria-label="Delete draft delivery"
          title="Delete this draft"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </li>
  );
}

const INSPECTION_STATUS_LABEL: Record<InspectionStatus, string> = {
  draft: "Draft",
  submitted: "Awaiting QC",
  approved: "Approved",
  hold: "On hold",
  rejected: "Rejected",
};

const INSPECTION_STATUS_TONE: Record<InspectionStatus, string> = {
  draft: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  submitted: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  hold: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
};

function InspectionStatusPill({ inspection }: { inspection: Inspection }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        INSPECTION_STATUS_TONE[inspection.status],
      )}
    >
      {INSPECTION_STATUS_LABEL[inspection.status]}
    </span>
  );
}

function ConcurrentDraftConfirm({
  draftOperatorName,
  onCancel,
  onConfirm,
  pending,
}: {
  draftOperatorName: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-end bg-black/40 px-3 pb-3"
      onClick={onCancel}
    >
      <div
        className="w-full rounded-xl border border-border/60 bg-background p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" />
          <div className="space-y-1">
            <p className="text-sm font-semibold">Start a separate delivery?</p>
            <p className="text-xs text-muted-foreground">
              {draftOperatorName
                ? `${draftOperatorName}'s draft is still open. Only do this if you're logging a different truckload from the same PO.`
                : "A draft is already open on this PO. Only do this if you're logging a different truckload."}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="flex-1 text-xs"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="lg"
            className="flex-1 gap-1.5 text-sm font-semibold"
            onClick={onConfirm}
            disabled={pending}
          >
            <Plus className="size-4" />
            New delivery
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreReceiveLineRow({
  line,
  poWarehouseId,
  checked,
  onToggle,
}: {
  line: PurchaseOrderLine;
  poWarehouseId: number | null;
  /** Present in the tickable "what's on this truck?" mode; omitted
   *  when the row is a read-only preview (draft-resume case). */
  checked?: boolean;
  onToggle?: (checked: boolean) => void;
}) {
  const prefs = useFormatPrefs();
  const item = line.item;
  const uomSymbol = item?.stock_uom?.symbol ?? item?.stock_uom?.code ?? null;
  const chips = computeComplianceChips(item);

  const qtyOrdered = Number(line.qty_ordered) || 0;
  const qtyReceived = Number(line.qty_received) || 0;
  const qtyRemaining = Math.max(qtyOrdered - qtyReceived, 0);
  const isPartial = qtyReceived > 0 && qtyReceived < qtyOrdered;
  const isComplete = qtyReceived >= qtyOrdered && qtyOrdered > 0;
  // Fully-received lines can't be ticked in the normal flow — the
  // vendor already fulfilled this line, so ticking it would only make
  // sense for a rare over-shipment. Blocking the tick here forces
  // over-ships to go through a deliberate flow (not just an
  // accidental tap while scrolling).
  const tickable = typeof onToggle === "function" && !isComplete;

  // Per-line warehouse only matters when it deviates from the PO
  // header default — otherwise it's noise that distracts from the
  // delivery-address verification.
  const hasWarehouseOverride =
    line.warehouse_id != null && line.warehouse_id !== poWarehouseId;

  return (
    <li
      className={cn(
        "rounded-xl border border-border/60 bg-card px-3 py-3",
        tickable && "cursor-pointer",
        isComplete && typeof onToggle === "function" && "opacity-70",
      )}
      onClick={
        tickable
          ? (e) => {
              // Ignore clicks that originated on the checkbox itself
              // (browser already fires onChange for that).
              const target = e.target as HTMLElement;
              if (target.tagName === "INPUT") return;
              onToggle!(!checked);
            }
          : undefined
      }
    >
      <div className="flex items-start gap-2">
        {typeof onToggle === "function" ? (
          isComplete ? (
            // Fully-received: no checkbox, show the completed icon so
            // the operator sees the row's status at a glance.
            <CheckCircle2
              className="mt-0.5 size-5 shrink-0 text-emerald-500/70"
              aria-label="Fully received — cannot tick"
            />
          ) : (
            <input
              type="checkbox"
              checked={Boolean(checked)}
              onChange={(e) => onToggle!(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-foreground"
              aria-label={`Include ${item?.name ?? "line"} in this delivery`}
            />
          )
        ) : (
          <PackageCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="space-y-0.5">
            <p className="truncate text-sm font-medium">
              {item?.name ?? "Unknown item"}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              {item?.code && (
                <span className="font-mono">{item.code}</span>
              )}
              {line.vendor_part_no && (
                <span className="font-mono">
                  Vendor: {line.vendor_part_no}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px]">
            <span className="font-mono text-sm font-semibold">
              {formatCompanyNumber(qtyOrdered, prefs)}
              {uomSymbol ? ` ${uomSymbol}` : ""}
            </span>
            <span className="text-muted-foreground">expected</span>
            {isPartial && (
              <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                {formatCompanyNumber(qtyReceived, prefs)} already in ·{" "}
                {formatCompanyNumber(qtyRemaining, prefs)} remaining
              </span>
            )}
            {isComplete && (
              <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                Fully received
              </span>
            )}
          </div>

          {hasWarehouseOverride && line.warehouse?.name && (
            <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Warehouse className="size-3" />
              Route to {line.warehouse.name}
            </p>
          )}

          {line.notes && (
            <p className="rounded-md bg-muted/50 px-2 py-1 text-[11px] text-foreground/80">
              {line.notes}
            </p>
          )}

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

// Generic icon-label-value row. `sub` is an optional secondary line
// (address under warehouse, ordered-by under date, etc.).
function DetailRow({
  icon: Icon,
  label,
  value,
  sub,
  subIcon: SubIcon,
}: {
  icon: typeof AlertTriangle;
  label: string;
  value: ReactNode;
  sub?: string;
  subIcon?: typeof AlertTriangle;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <div className="text-sm font-medium text-foreground">{value}</div>
        {sub && (
          <p className="inline-flex items-start gap-1 text-[11px] text-muted-foreground">
            {SubIcon && <SubIcon className="mt-0.5 size-3 shrink-0" />}
            <span className="whitespace-pre-wrap">{sub}</span>
          </p>
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Partial<Record<PurchaseOrder["status"], string>> = {
  ordered: "Ordered",
  partially_received: "Partial",
  received: "Received",
  approved: "Approved",
};

const STATUS_TONE: Partial<
  Record<PurchaseOrder["status"], string>
> = {
  ordered: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  partially_received: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  received: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  approved: "bg-muted text-foreground/70",
};

function StatusBadge({ status }: { status: PurchaseOrder["status"] }) {
  const label = STATUS_LABEL[status];
  if (!label) return null;
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        STATUS_TONE[status] ?? "bg-muted text-foreground/70",
      )}
    >
      {label}
    </span>
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

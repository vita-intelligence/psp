"use client";

/**
 * Inline section rendered inside the schedule edit dialog when the
 * scope is a single MO. Lets the planner release the MO to the
 * warehouse picker queue (or pull it back). Read-only when:
 *
 *   - the MO isn't in `scheduled` status (release requires scheduled)
 *   - the user isn't head-of-room (other co-editors see the state but
 *     can't fire the action — head-of-room save gate)
 *   - the user lacks `production.mo_release`
 *
 * The MO's pickup state is column-derived on the BE; this component
 * projects it to one of: not-released / released / picking-in-progress
 * / handed-off and renders the matching action.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PackageCheck,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clearReplanAction,
  releaseManufacturingOrderToWarehouseAction,
  unreleaseManufacturingOrderFromWarehouseAction,
} from "@/lib/production/actions";
import type {
  AwaitingChildLine,
  BrokenBooking,
  LotOffWarehouseRow,
  ScheduleOperationMOSummary,
  UnderBookedLine,
} from "@/lib/production/types";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";

interface Props {
  mo: ScheduleOperationMOSummary;
  canRelease: boolean;
  isCreator: boolean;
  defaultWindowHours: number;
  companyDateFormat: FormatPrefs;
  onChanged: () => void;
}

type ProjectedState =
  | "not_scheduled"
  | "not_released"
  | "released"
  | "picking_in_progress"
  | "handed_off";

function projectState(mo: ScheduleOperationMOSummary): ProjectedState {
  if (mo.pickup_completed_at) return "handed_off";
  if (mo.pickup_started_at) return "picking_in_progress";
  if (mo.released_to_warehouse_at) return "released";
  // Calendar drop no longer auto-flips status — an MO is releasable
  // once it sits on the calendar (status approved OR scheduled). The
  // edit dialog only opens for MOs on the calendar in the first place,
  // so we accept both pre-release statuses here.
  if (!["approved", "scheduled"].includes(mo.status)) return "not_scheduled";
  return "not_released";
}

export function ScheduleReleaseSection({
  mo,
  canRelease,
  isCreator,
  defaultWindowHours,
  companyDateFormat,
  onChanged,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);
  const [windowHours, setWindowHours] = useState<number>(
    mo.pickup_window_hours ?? defaultWindowHours,
  );

  const state = projectState(mo);
  const qcPending = mo.qc_pending_count ?? 0;
  const qcBlocked = state === "not_released" && qcPending > 0;
  const brokenCount = mo.broken_bookings_count ?? 0;
  const underBookedCount = mo.under_booked_count ?? 0;
  const awaitingChildCount = mo.lines_awaiting_child_output?.length ?? 0;
  const offWarehouseCount = mo.bookings_lot_off_warehouse?.length ?? 0;
  const issuesCount =
    brokenCount + underBookedCount + awaitingChildCount + offWarehouseCount;
  const needsReplan = mo.needs_replan ?? false;
  // After release, bookings can go bad — peer MO consumed more than
  // expected (over-allocation) or QC flipped a previously-available
  // lot. The banner stays visible until the planner pulls the MO back
  // and re-books.
  const brokenAfterRelease =
    issuesCount > 0 && (state === "released" || state === "picking_in_progress");

  function handleRelease() {
    if (!canRelease || !isCreator) return;
    startTransition(async () => {
      const res = await releaseManufacturingOrderToWarehouseAction(
        mo.uuid,
        windowHours === defaultWindowHours ? null : windowHours,
      );
      if (res.ok) {
        toast.success("Released to warehouse");
        setShowConfirm(false);
        onChanged();
      } else if (res.code === "stale_bookings") {
        toast.error("Some booked lots aren't available", {
          description:
            "Resolve QC (pass / hold / release) on the flagged lots before releasing.",
        });
      } else {
        toast.error(res.detail ?? "Couldn't release this MO.");
      }
    });
  }

  function handleUnrelease(replanReason?: string) {
    if (!canRelease || !isCreator) return;
    startTransition(async () => {
      const res = await unreleaseManufacturingOrderFromWarehouseAction(
        mo.uuid,
        replanReason,
      );
      if (res.ok) {
        toast.success(
          replanReason
            ? "Pulled back — bookings need rework"
            : "Pulled back from warehouse",
        );
        onChanged();
      } else if (res.code === "pickup_in_progress") {
        toast.error("Picker is on the floor", {
          description:
            "Wait for the picker to finish or abort before unreleasing.",
        });
      } else {
        toast.error(res.detail ?? "Couldn't unrelease this MO.");
      }
    });
  }

  function handleClearReplan() {
    if (!canRelease || !isCreator) return;
    startTransition(async () => {
      const res = await clearReplanAction(mo.uuid);
      if (res.ok) {
        toast.success("Replan cleared — MO is releasable again");
        onChanged();
      } else if (res.code === "lines_under_booked") {
        toast.error("BOM still under-booked", {
          description: res.detail,
        });
      } else {
        toast.error(res.detail ?? "Couldn't clear replan.");
      }
    });
  }

  if (state === "not_scheduled") {
    return null;
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Truck className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Warehouse pickup</h3>
            <StatusPill state={state} />
            {state === "not_released" && qcPending > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-2.5" />
                {qcPending} QC pending
              </span>
            )}
            {brokenCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-2.5" />
                {brokenCount} broken
              </span>
            )}
            {needsReplan && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
                <AlertTriangle className="size-2.5" />
                Needs replan
              </span>
            )}
          </div>
          {needsReplan && (
            <div className="mt-1 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs text-red-900 dark:text-red-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">Replan required</p>
                <p className="text-[11px] opacity-80">
                  {mo.needs_replan_reason ??
                    "Something broke this MO's plan — review bookings, then click Mark replanned."}
                </p>
                {canRelease && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-1 h-7 text-[11px]"
                    disabled={!isCreator || pending}
                    onClick={handleClearReplan}
                  >
                    {pending && (
                      <Loader2 className="mr-1.5 size-3 animate-spin" />
                    )}
                    <CheckCircle2 className="mr-1.5 size-3" />
                    Mark replanned
                  </Button>
                )}
              </div>
            </div>
          )}
          {state === "not_released" && qcPending === 0 && issuesCount === 0 && (
            <p className="text-xs text-muted-foreground">
              Release this MO to the warehouse picker queue. Pickers will see
              it from the start of the visibility window onward.
            </p>
          )}
          {state === "not_released" && issuesCount > 0 && (
            <ReleaseBlockedDetails
              brokenBookings={mo.broken_bookings ?? []}
              underBookedLines={mo.under_booked_lines ?? []}
              awaitingChildLines={mo.lines_awaiting_child_output ?? []}
              offWarehouseRows={mo.bookings_lot_off_warehouse ?? []}
            />
          )}
          {state === "released" && mo.released_to_warehouse_at && (
            <p className="text-xs text-muted-foreground">
              Released on{" "}
              {formatCompanyDate(mo.released_to_warehouse_at, companyDateFormat)}{" "}
              · {mo.pickup_window_hours ?? defaultWindowHours}h window
            </p>
          )}
          {brokenAfterRelease && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <div className="space-y-0.5">
                <p className="font-medium">
                  {brokenCount} booked {brokenCount === 1 ? "lot" : "lots"} need
                  attention
                </p>
                <p className="text-[11px] opacity-80">
                  A booked lot was rejected, sent back to quarantine, or
                  over-consumed by another MO. Pull this MO back to{" "}
                  <code>approved</code> to re-book or spawn a child MO.
                </p>
              </div>
            </div>
          )}
          {state === "picking_in_progress" && mo.pickup_started_at && (
            <p className="text-xs text-muted-foreground">
              Picking started{" "}
              {formatCompanyDate(mo.pickup_started_at, companyDateFormat)}.
              Calendar block is locked until pickup completes or aborts.
            </p>
          )}
          {state === "handed_off" && mo.pickup_completed_at && (
            <p className="text-xs text-muted-foreground">
              Handed off to production on{" "}
              {formatCompanyDate(mo.pickup_completed_at, companyDateFormat)}.
            </p>
          )}
        </div>

        {canRelease && state === "not_released" && !showConfirm && (
          <Button
            type="button"
            size="sm"
            disabled={
              !isCreator ||
              pending ||
              qcBlocked ||
              needsReplan ||
              issuesCount > 0
            }
            onClick={() => setShowConfirm(true)}
            title={
              issuesCount > 0
                ? `${issuesCount} booking${issuesCount === 1 ? " or BOM line is" : "s or BOM lines are"} short or broken — fix on the MO detail page first.`
                : needsReplan
                  ? "MO needs replan — re-prepare + re-approve after editing bookings."
                  : qcBlocked
                    ? `${qcPending} booked lot${qcPending === 1 ? "" : "s"} still in QC — clear before releasing.`
                    : !isCreator
                      ? "Only the head of this edit room can release."
                      : undefined
            }
          >
            <Truck className="mr-1.5 size-3.5" />
            Release to warehouse
          </Button>
        )}

        {canRelease && state === "released" && (
          <Button
            type="button"
            size="sm"
            variant={brokenAfterRelease ? "default" : "outline"}
            disabled={!isCreator || pending}
            onClick={() =>
              handleUnrelease(
                brokenAfterRelease
                  ? "Pulled back to fix broken bookings"
                  : undefined,
              )
            }
          >
            {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {brokenAfterRelease ? "Pull back to fix" : "Unrelease"}
          </Button>
        )}
      </div>

      {showConfirm && state === "not_released" && (
        <div className="mt-3 rounded-md border border-dashed border-border/60 bg-muted/30 p-3 space-y-3">
          <div className="space-y-2">
            <Label htmlFor="release-window" className="text-xs">
              Visibility window (hours before planned start)
            </Label>
            <Input
              id="release-window"
              type="number"
              min={1}
              max={720}
              step={1}
              value={windowHours}
              onChange={(e) =>
                setWindowHours(Math.max(1, Number(e.target.value || 0)))
              }
              className="h-9 max-w-[160px]"
            />
            <p className="text-[11px] text-muted-foreground">
              Defaults to the company setting ({defaultWindowHours}h). Picker
              will see this MO from {windowHours}h before its planned start.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowConfirm(false);
                setWindowHours(mo.pickup_window_hours ?? defaultWindowHours);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleRelease}
              disabled={!isCreator || pending}
            >
              {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              Confirm release
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Row-per-issue blocker list rendered when release is blocked. Each
 *  row names the item + lot and links to the right place to fix
 *  ("Pass QC on /m/inspections", "Open lot to record Pass-QC",
 *  "Pull back to fix bookings"). Replaces the old generic
 *  "X bookings short/broken" banner that left the planner guessing.
 */
function ReleaseBlockedDetails({
  brokenBookings,
  underBookedLines,
  awaitingChildLines,
  offWarehouseRows,
}: {
  brokenBookings: BrokenBooking[];
  underBookedLines: UnderBookedLine[];
  awaitingChildLines: AwaitingChildLine[];
  offWarehouseRows: LotOffWarehouseRow[];
}) {
  const total =
    brokenBookings.length +
    underBookedLines.length +
    awaitingChildLines.length +
    offWarehouseRows.length;
  if (total === 0) return null;

  return (
    <div className="space-y-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs text-red-900 dark:text-red-200">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-3.5 shrink-0" />
        <p className="font-medium">
          Release blocked — {total} issue{total === 1 ? "" : "s"} to fix
        </p>
      </div>
      <ul className="space-y-1.5 pl-5">
        {brokenBookings.map((b) => (
          <li key={b.booking_uuid} className="list-disc text-[11px]">
            <BrokenBookingRow booking={b} />
          </li>
        ))}
        {underBookedLines.map((l) => (
          <li key={`under-${l.item_id}`} className="list-disc text-[11px]">
            <UnderBookedLineRow line={l} />
          </li>
        ))}
        {awaitingChildLines.map((l) => (
          <li key={`awaiting-${l.item_id}`} className="list-disc text-[11px]">
            <AwaitingChildLineRow line={l} />
          </li>
        ))}
        {offWarehouseRows.map((r) => (
          <li key={`off-${r.booking_uuid}`} className="list-disc text-[11px]">
            <OffWarehouseRow row={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function OffWarehouseRow({ row }: { row: LotOffWarehouseRow }) {
  return (
    <span>
      <strong>{row.item_name}</strong> · only {row.in_warehouse_qty} of{" "}
      {row.booked_qty} is in a warehouse cell — the rest is still at
      production. Run the warehouse return-pickup flow at{" "}
      <Link href="/m/return-pickup" className="underline underline-offset-2">
        /m/return-pickup
      </Link>{" "}
      to move it back, then release.
    </span>
  );
}

function AwaitingChildLineRow({ line }: { line: AwaitingChildLine }) {
  const children = line.waiting_on_children;
  return (
    <span>
      <strong>{line.item_name}</strong> · short by {line.short} (booked{" "}
      {line.booked} of {line.required}). Waiting on{" "}
      {children.length === 0 ? (
        <em>a child MO that produces this part</em>
      ) : (
        children.map((c, i) => (
          <span key={c.uuid}>
            {i > 0 && ", "}
            <Link
              href={`/production/manufacturing-orders/${c.uuid}`}
              className="underline underline-offset-2 hover:text-red-700 dark:hover:text-red-100"
            >
              {c.code ?? `MO #${c.id}`}
            </Link>
            {" "}({c.status})
          </span>
        ))
      )}{" "}
      to finish + pass Output QC, then book the new lot here before
      releasing.
    </span>
  );
}

function BrokenBookingRow({ booking }: { booking: BrokenBooking }) {
  const lotLabel = booking.lot_code ?? `lot ${booking.lot_uuid.slice(0, 6)}…`;

  if (booking.reason === "over_allocated") {
    return (
      <span>
        <strong>{booking.item_name}</strong> · {lotLabel} is over-allocated
        (booked {booking.total_booked_qty}, on hand {booking.on_hand_qty}).
        Pull this MO back and re-book against a different lot.
      </span>
    );
  }

  // reason = lot_unavailable. Branch on source so the fix path is
  // exact: MO-output → Output QC; PO-receipt → Goods-In; manual /
  // opening-balance → open the lot and record Pass-QC.
  if (booking.lot_source_kind === "manufacturing_order" && booking.producing_mo) {
    return (
      <span>
        <strong>{booking.item_name}</strong> · {lotLabel} (from{" "}
        <Link
          href={`/production/manufacturing-orders/${booking.producing_mo.uuid}`}
          className="underline underline-offset-2 hover:text-red-700 dark:hover:text-red-100"
        >
          {booking.producing_mo.code ?? `MO #${booking.producing_mo.id}`}
        </Link>
        ) is {booking.lot_status}. Run Output QC on the producing MO at{" "}
        <Link href="/m/inspections" className="underline underline-offset-2">
          /m/inspections
        </Link>
        .
      </span>
    );
  }

  if (booking.lot_source_kind === "purchase_order") {
    return (
      <span>
        <strong>{booking.item_name}</strong> · {lotLabel} is{" "}
        {booking.lot_status}. Clear via Goods-In Inspection at{" "}
        <Link href="/m/inspections" className="underline underline-offset-2">
          /m/inspections
        </Link>
        .
      </span>
    );
  }

  return (
    <span>
      <strong>{booking.item_name}</strong> · {lotLabel} is{" "}
      {booking.lot_status}. Open the lot and record a Pass-QC event to mark
      it available.
    </span>
  );
}

function UnderBookedLineRow({ line }: { line: UnderBookedLine }) {
  return (
    <span>
      <strong>{line.item_name}</strong> · short by {line.short} (booked{" "}
      {line.booked} of {line.required}). Book more lots, spawn a child MO,
      or click <em>Request purchases</em> on the MO to send the shortage
      to procurement.
    </span>
  );
}

function StatusPill({ state }: { state: ProjectedState }) {
  if (state === "released") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
        <Truck className="size-2.5" />
        Released
      </span>
    );
  }
  if (state === "picking_in_progress") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        <Loader2 className="size-2.5 animate-spin" />
        Picking
      </span>
    );
  }
  if (state === "handed_off") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
        <PackageCheck className="size-2.5" />
        At production
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      <CheckCircle2 className="size-2.5" />
      Not released
    </span>
  );
}

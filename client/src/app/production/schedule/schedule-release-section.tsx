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
  releaseManufacturingOrderToWarehouseAction,
  unreleaseManufacturingOrderFromWarehouseAction,
} from "@/lib/production/actions";
import type { ScheduleOperationMOSummary } from "@/lib/production/types";
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

  function handleUnrelease() {
    if (!canRelease || !isCreator) return;
    startTransition(async () => {
      const res = await unreleaseManufacturingOrderFromWarehouseAction(mo.uuid);
      if (res.ok) {
        toast.success("Pulled back from warehouse");
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
          </div>
          {state === "not_released" && qcPending === 0 && (
            <p className="text-xs text-muted-foreground">
              Release this MO to the warehouse picker queue. Pickers will see
              it from the start of the visibility window onward.
            </p>
          )}
          {state === "not_released" && qcPending > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <div className="space-y-0.5">
                <p className="font-medium">
                  {qcPending} booked {qcPending === 1 ? "lot" : "lots"} awaiting
                  QC
                </p>
                <p className="text-[11px] opacity-80">
                  Run Goods-In Inspection at <code>/m/inspections</code> to
                  clear them. Release stays gated until every booked lot is
                  available.
                </p>
              </div>
            </div>
          )}
          {state === "released" && mo.released_to_warehouse_at && (
            <p className="text-xs text-muted-foreground">
              Released on{" "}
              {formatCompanyDate(mo.released_to_warehouse_at, companyDateFormat)}{" "}
              · {mo.pickup_window_hours ?? defaultWindowHours}h window
            </p>
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
            disabled={!isCreator || pending || qcBlocked}
            onClick={() => setShowConfirm(true)}
            title={
              qcBlocked
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
            variant="outline"
            disabled={!isCreator || pending}
            onClick={handleUnrelease}
          >
            {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Unrelease
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

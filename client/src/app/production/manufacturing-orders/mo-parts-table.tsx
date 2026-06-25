"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Factory,
  Loader2,
  Plus,
  RotateCcw,
} from "lucide-react";
import {
  formatCompanyMoney,
  formatCompanyNumber,
  formatCompanyDate,
} from "@/lib/format/company";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { releaseAllPartsAction } from "@/lib/production/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type { CompanyDefaults } from "@/lib/types";
import type {
  ManufacturingOrder,
  ManufacturingOrderBooking,
  ManufacturingOrderPart,
  ManufacturingOrderRelation,
} from "@/lib/production/types";
import { AddBookingDialog } from "./add-booking-dialog";
import { ReleaseBookingDialog } from "./release-booking-dialog";
import { BookAllDialog } from "./book-all-dialog";
import { AddSubMoDialog } from "./add-sub-mo-dialog";
import { ReleaseSubMoDialog } from "./release-sub-mo-dialog";

interface Props {
  mo: ManufacturingOrder;
  company: CompanyDefaults;
  canEdit: boolean;
}

/**
 * MRPEasy-style parts breakdown. Each BOM line is a master row
 * with the aggregated booked / consumed / cost; individual bookings
 * are sub-rows underneath. `+` on the master opens the
 * AddBookingDialog; the circular-arrow on a sub-row opens the
 * ReleaseBookingDialog.
 */
export function MOPartsTable({ mo, company, canEdit }: Props) {
  const router = useRouter();
  const [addingFor, setAddingFor] =
    useState<ManufacturingOrderPart | null>(null);
  const [releasing, setReleasing] = useState<{
    part: ManufacturingOrderPart;
    booking: ManufacturingOrderBooking;
  } | null>(null);
  const [addingSubMoFor, setAddingSubMoFor] =
    useState<ManufacturingOrderPart | null>(null);
  const [releasingSubMo, setReleasingSubMo] = useState<{
    part: ManufacturingOrderPart;
    child: ManufacturingOrderRelation;
  } | null>(null);
  const [bookAllOpen, setBookAllOpen] = useState(false);
  const [pendingAll, startTransitionAll] = useTransition();

  if (mo.parts.length === 0) {
    return (
      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="mb-3">
          <h2 className="text-sm font-semibold tracking-tight">Parts</h2>
        </header>
        <p className="text-xs text-muted-foreground">
          The connected BOM doesn&apos;t have any parts yet.
        </p>
      </section>
    );
  }

  const hasAnyBookings = mo.parts.some((p) => p.bookings.length > 0);

  function onReleaseAll() {
    if (!canEdit) return;
    if (
      !window.confirm(
        "Release every active booking on this MO AND cancel sub-MOs still in draft / approved? In-progress and completed sub-MOs stay put.",
      )
    ) {
      return;
    }
    startTransitionAll(async () => {
      const res = await releaseAllPartsAction(mo.uuid);
      if (res.ok) {
        const parts: string[] = [];
        if (res.released > 0) {
          parts.push(
            `${res.released} booking${res.released === 1 ? "" : "s"} released`,
          );
        }
        if (res.cancelled_sub_mos > 0) {
          parts.push(
            `${res.cancelled_sub_mos} sub-MO${res.cancelled_sub_mos === 1 ? "" : "s"} cancelled`,
          );
        }
        toast.success(parts.length === 0 ? "Nothing to release." : parts.join(" · "));
        invalidateAudit("manufacturing_order", mo.id);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Parts</h2>
        <p className="text-[11px] text-muted-foreground">
          {mo.bom?.code ?? "BOM"} — required for{" "}
          {formatCompanyNumber(mo.quantity, company)}{" "}
          {mo.item?.stock_uom?.symbol ?? "Each"}
        </p>
      </header>

      {canEdit && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pendingAll}
            onClick={() => setBookAllOpen(true)}
          >
            <Plus className="size-3.5" />
            Book all parts
          </Button>
          {hasAnyBookings && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pendingAll}
              onClick={onReleaseAll}
              className="text-muted-foreground"
            >
              {pendingAll ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RotateCcw className="size-3.5" />
              )}
              Release all booked parts
            </Button>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] text-xs">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Stock item</th>
              <th className="px-2 py-1.5 text-right">Required</th>
              <th className="px-2 py-1.5 text-right">Consumed</th>
              <th className="px-2 py-1.5 text-right">Booked</th>
              <th className="px-2 py-1.5 text-right">Unit cost</th>
              <th className="px-2 py-1.5 text-right">Total cost</th>
              <th className="px-2 py-1.5 text-left">Lot</th>
              <th className="px-2 py-1.5 text-left">Status</th>
              <th className="px-2 py-1.5 text-left">Sign-offs</th>
              <th className="px-2 py-1.5 text-left">Storage</th>
              <th className="px-2 py-1.5 text-left">Available from</th>
              <th className="w-10 px-2 py-1.5" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {mo.parts.map((p) => (
              <PartRows
                key={p.id}
                p={p}
                company={company}
                canEdit={canEdit}
                onAdd={() => setAddingFor(p)}
                onRelease={(b) => setReleasing({ part: p, booking: b })}
                onAddSubMo={() => setAddingSubMoFor(p)}
                onReleaseSubMo={(child) =>
                  setReleasingSubMo({ part: p, child })
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      {addingFor && (
        <AddBookingDialog
          mo={mo}
          part={addingFor}
          company={company}
          open={Boolean(addingFor)}
          onOpenChange={(o) => !o && setAddingFor(null)}
        />
      )}

      {releasing && (
        <ReleaseBookingDialog
          mo={mo}
          part={releasing.part}
          booking={releasing.booking}
          company={company}
          open={Boolean(releasing)}
          onOpenChange={(o) => !o && setReleasing(null)}
        />
      )}

      {bookAllOpen && (
        <BookAllDialog
          mo={mo}
          open={bookAllOpen}
          onOpenChange={setBookAllOpen}
        />
      )}

      {addingSubMoFor && (
        <AddSubMoDialog
          mo={mo}
          part={addingSubMoFor}
          company={company}
          open={Boolean(addingSubMoFor)}
          onOpenChange={(o) => !o && setAddingSubMoFor(null)}
        />
      )}

      {releasingSubMo && (
        <ReleaseSubMoDialog
          mo={mo}
          part={releasingSubMo.part}
          child={releasingSubMo.child}
          company={company}
          open={Boolean(releasingSubMo)}
          onOpenChange={(o) => !o && setReleasingSubMo(null)}
        />
      )}
    </section>
  );
}

interface PartRowsProps {
  p: ManufacturingOrderPart;
  company: CompanyDefaults;
  canEdit: boolean;
  onAdd: () => void;
  onRelease: (b: ManufacturingOrderBooking) => void;
  onAddSubMo: () => void;
  onReleaseSubMo: (child: ManufacturingOrderRelation) => void;
}

function PartRows({
  p,
  company,
  canEdit,
  onAdd,
  onRelease,
  onAddSubMo,
  onReleaseSubMo,
}: PartRowsProps) {
  const hasUnbooked = Number(p.unbooked_qty ?? "0") > 0;
  const hasBookings =
    p.bookings.length > 0 || p.pending_from_sub_mos.length > 0 || hasUnbooked;
  const [open, setOpen] = useState(hasBookings);
  const uom =
    p.unit_of_measurement?.symbol ?? p.part?.stock_uom?.symbol ?? "";

  return (
    <>
      <tr className="border-y border-border/60 bg-muted/20 font-medium">
        <td className="px-2 py-2">
          <div className="flex items-center gap-1.5">
            {hasBookings ? (
              <button
                type="button"
                onClick={() => setOpen(!open)}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                aria-label={open ? "Collapse bookings" : "Expand bookings"}
              >
                {open ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>
            ) : (
              <span className="inline-block size-3.5" />
            )}
            <div className="min-w-0">
              <p className="text-sm">
                {p.part?.name ?? `Item #${p.part?.id ?? "?"}`}
              </p>
              {p.part?.code && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  {p.part.code}
                </p>
              )}
            </div>
          </div>
        </td>
        <td className="px-2 py-2 text-right font-mono">
          {p.required_qty
            ? `${formatCompanyNumber(p.required_qty, company)} ${uom}`.trim()
            : "—"}
          {p.is_fixed && (
            <p className="text-[9px] text-muted-foreground">fixed</p>
          )}
        </td>
        <td className="px-2 py-2 text-right font-mono">
          {p.consumed_qty
            ? `${formatCompanyNumber(p.consumed_qty, company)} ${uom}`.trim()
            : `0 ${uom}`.trim()}
        </td>
        <td className="px-2 py-2 text-right font-mono">
          {p.booked_qty
            ? `${formatCompanyNumber(p.booked_qty, company)} ${uom}`.trim()
            : `0 ${uom}`.trim()}
        </td>
        <td className="px-2 py-2 text-right font-mono">
          {p.unit_cost ? formatCompanyMoney(p.unit_cost, company) : "—"}
        </td>
        <td className="px-2 py-2 text-right font-mono">
          {p.total_cost ? formatCompanyMoney(p.total_cost, company) : "—"}
        </td>
        <td className="px-2 py-2 text-muted-foreground/60">—</td>
        <td className="px-2 py-2">
          <UnderBookedBadge p={p} />
        </td>
        <td className="px-2 py-2 text-muted-foreground/60">—</td>
        <td className="px-2 py-2 text-muted-foreground/60">—</td>
        <td className="px-2 py-2 text-muted-foreground/60">—</td>
        <td className="px-1 py-1 text-right">
          {canEdit && (
            <div className="flex items-center justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={onAdd}
                aria-label="Book from stock"
                title="Book from stock"
              >
                <Plus />
              </Button>
              {p.part?.item_type === "semi_finished" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={onAddSubMo}
                  aria-label="Add a sub-MO"
                  title="Add a sub-MO"
                  className="text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/30"
                >
                  <Factory />
                </Button>
              )}
            </div>
          )}
        </td>
      </tr>
      {open &&
        p.bookings.map((b) => (
          <BookingRow
            key={b.id}
            booking={b}
            uom={uom}
            unitCost={p.unit_cost}
            company={company}
            canEdit={canEdit}
            onRelease={() => onRelease(b)}
          />
        ))}
      {open && hasUnbooked && (
        <NotBookedRow
          part={p}
          uom={uom}
          unitCost={p.unit_cost}
          unbookedQty={p.unbooked_qty ?? "0"}
          company={company}
          canEdit={canEdit}
          onAddBooking={onAdd}
          onAddSubMo={onAddSubMo}
        />
      )}
      {open &&
        p.pending_from_sub_mos.map((child) => (
          <PendingSubMoRow
            key={`sub-${child.id}`}
            child={child}
            uom={uom}
            unitCost={p.unit_cost}
            company={company}
            canEdit={canEdit}
            onRelease={() => onReleaseSubMo(child)}
          />
        ))}
    </>
  );
}

const COVERAGE_STYLE: Record<
  ManufacturingOrderPart["coverage_status"],
  { text: string; label: string; dot: string }
> = {
  booked: {
    text: "text-emerald-700 dark:text-emerald-300",
    label: "Booked",
    dot: "bg-emerald-500",
  },
  sub_mo_in_progress: {
    text: "text-amber-800 dark:text-amber-300",
    label: "Sub-MO running",
    dot: "bg-amber-500 animate-pulse",
  },
  partial: {
    text: "text-amber-800 dark:text-amber-300",
    label: "Partial",
    dot: "bg-amber-500",
  },
  expecting: {
    text: "text-sky-700 dark:text-sky-300",
    label: "Expecting (PO out)",
    dot: "bg-sky-500",
  },
  awaiting_po: {
    text: "text-sky-700 dark:text-sky-300",
    label: "Sent to procurement",
    dot: "bg-sky-500",
  },
  not_booked: {
    text: "text-destructive",
    label: "Not booked",
    dot: "bg-destructive",
  },
  consumed: {
    text: "text-emerald-700 dark:text-emerald-300",
    label: "Consumed",
    dot: "bg-emerald-500",
  },
  consumed_short: {
    text: "text-muted-foreground",
    label: "Consumed (less than planned)",
    dot: "bg-muted-foreground",
  },
  consumed_none: {
    text: "text-muted-foreground/60",
    label: "Not consumed",
    dot: "bg-muted-foreground/40",
  },
  unknown: {
    text: "text-muted-foreground/60",
    label: "—",
    dot: "bg-muted-foreground/40",
  },
};

function UnderBookedBadge({ p }: { p: ManufacturingOrderPart }) {
  const style = COVERAGE_STYLE[p.coverage_status];
  return (
    <span className={cn("inline-flex items-center gap-1.5", style.text)}>
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
      {style.label}
    </span>
  );
}

interface BookingRowProps {
  booking: ManufacturingOrderBooking;
  uom: string;
  unitCost: string | null;
  company: CompanyDefaults;
  canEdit: boolean;
  onRelease: () => void;
}

function BookingRow({
  booking,
  uom,
  unitCost,
  company,
  canEdit,
  onRelease,
}: BookingRowProps) {
  const lineTotal =
    unitCost && booking.quantity
      ? String(Number(unitCost) * Number(booking.quantity))
      : null;

  return (
    <tr className="border-b border-border/40">
      <td className="px-2 py-1.5 pl-8 text-muted-foreground" />
      <td className="px-2 py-1.5 text-right" />
      <td className="px-2 py-1.5 text-right font-mono">
        {booking.consumed_quantity
          ? `${formatCompanyNumber(booking.consumed_quantity, company)} ${uom}`.trim()
          : `0 ${uom}`.trim()}
      </td>
      <td className="px-2 py-1.5 text-right font-mono">
        {formatCompanyNumber(booking.quantity, company)} {uom}
      </td>
      <td className="px-2 py-1.5 text-right font-mono">
        {unitCost ? formatCompanyMoney(unitCost, company) : "—"}
      </td>
      <td className="px-2 py-1.5 text-right font-mono">
        {lineTotal ? formatCompanyMoney(lineTotal, company) : "—"}
      </td>
      <td className="px-2 py-1.5 font-mono">
        {booking.stock_lot?.code ??
          (booking.purchase_order_line?.purchase_order?.code
            ? `↺ ${booking.purchase_order_line.purchase_order.code}`
            : "—")}
      </td>
      <td className="px-2 py-1.5">
        {booking.purchase_order_line_id != null ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300"
            title={
              booking.purchase_order_line?.expected_delivery_date
                ? `Arriving ${booking.purchase_order_line.expected_delivery_date}`
                : "Reserved against an in-flight PO"
            }
          >
            Expecting
          </span>
        ) : (
          <BookingStatusBadge status={booking.status} />
        )}
      </td>
      <td className="px-2 py-1.5">
        <BookingSignOffs booking={booking} company={company} />
      </td>
      <td className="px-2 py-1.5">
        {(() => {
          const cell = booking.storage_location;
          if (!cell) return "—";
          // Lead with the rack code (or location name) so the operator
          // can find the physical rack at a glance — "Level 0" alone
          // doesn't say WHERE. Suffix the cell label underneath.
          const rack =
            cell.storage_location?.code ??
            cell.storage_location?.name ??
            null;
          const shelf =
            cell.name ??
            (cell.ordinal !== null && cell.ordinal !== undefined
              ? `Level ${cell.ordinal + 1}`
              : null);
          if (rack && shelf) {
            return (
              <div className="leading-tight">
                <div className="font-mono text-[11px]">{rack}</div>
                <div className="text-[10px] text-muted-foreground">
                  {shelf}
                </div>
              </div>
            );
          }
          return rack ?? shelf ?? "—";
        })()}
      </td>
      <td className="px-2 py-1.5">
        {booking.stock_lot?.available_from
          ? formatCompanyDate(booking.stock_lot.available_from, company)
          : booking.stock_lot?.expiry_at
            ? formatCompanyDate(booking.stock_lot.expiry_at, company)
            : "—"}
      </td>
      <td className="px-1 py-1 text-right">
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onRelease}
            aria-label="Release this booking"
            title="Release this booking"
          >
            <RotateCcw />
          </Button>
        )}
      </td>
    </tr>
  );
}

const BOOKING_STATUS: Record<
  ManufacturingOrderBooking["status"],
  { text: string; bg: string; dot: string; label: string }
> = {
  requested: {
    text: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    dot: "bg-emerald-500",
    label: "Booked",
  },
  consumed: {
    text: "text-indigo-700 dark:text-indigo-300",
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    dot: "bg-indigo-500",
    label: "Consumed",
  },
  cancelled: {
    text: "text-muted-foreground",
    bg: "bg-muted/60",
    dot: "bg-muted-foreground/40",
    label: "Released",
  },
};

function BookingStatusBadge({
  status,
}: {
  status: ManufacturingOrderBooking["status"];
}) {
  const s = BOOKING_STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ring-border/40",
        s.bg,
        s.text,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

/** Three-step traceability for the booking lifecycle: warehouse
 *  picker (picked_at), production operator pre-production check
 *  (received_at), production operator closeout (consumed_at). Each
 *  stamp shows actor + date so the room sees who confirmed what
 *  without leaving the page. Empty when no stamp set. */
function BookingSignOffs({
  booking,
  company,
}: {
  booking: ManufacturingOrderBooking;
  company: CompanyDefaults;
}) {
  const stamps: Array<{
    label: string;
    at: string | null;
    by: { name: string } | null;
  }> = [
    {
      label: "Picked",
      at: booking.picked_at,
      by: booking.picked_by ?? null,
    },
    {
      label: "Confirmed",
      at: booking.received_at,
      by: booking.received_by ?? null,
    },
    {
      label: "Consumed",
      at: booking.consumed_at ?? null,
      by: booking.consumed_by ?? null,
    },
  ];

  const filled = stamps.filter((s) => s.at);
  if (filled.length === 0) {
    return <span className="text-muted-foreground/60">—</span>;
  }

  return (
    <div className="space-y-0.5 text-[10px] leading-tight">
      {filled.map((s) => (
        <div key={s.label}>
          <span className="font-medium text-foreground">{s.label}</span>{" "}
          <span className="text-muted-foreground">
            by {s.by?.name ?? "—"} ·{" "}
            {s.at ? formatCompanyDate(s.at, company) : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

interface NotBookedRowProps {
  part: ManufacturingOrderPart;
  uom: string;
  unitCost: string | null;
  unbookedQty: string;
  company: CompanyDefaults;
  canEdit: boolean;
  onAddBooking: () => void;
  onAddSubMo: () => void;
}

/**
 * MRPEasy-style "still missing" sub-row. Surfaces the gap (and its
 * £ value) as its own line so the operator sees exactly how much
 * coverage is short. Quick-action buttons let them resolve the gap
 * inline by either booking more stock or spawning another sub-MO.
 */
function NotBookedRow({
  part,
  uom,
  unitCost,
  unbookedQty,
  company,
  canEdit,
  onAddBooking,
  onAddSubMo,
}: NotBookedRowProps) {
  const lineTotal =
    unitCost && unbookedQty
      ? String(Number(unitCost) * Number(unbookedQty))
      : null;

  // If the parent row's coverage is "awaiting_po" (planner has hit
  // Request purchases for this gap), tone down the row from red to
  // sky-blue — the gap is handled, just waiting for procurement to
  // open the PO.
  const awaiting = part.coverage_status === "awaiting_po";
  const rowTint = awaiting ? "bg-sky-50/40" : "bg-destructive/[0.04]";
  const qtyTone = awaiting ? "text-sky-700 dark:text-sky-300" : "text-destructive";

  return (
    <tr className={cn("border-b border-border/40", rowTint)}>
      <td className="px-2 py-1.5 pl-8 text-xs text-muted-foreground" />
      <td className="px-2 py-1.5 text-right" />
      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground/60">
        —
      </td>
      <td className={cn("px-2 py-1.5 text-right font-mono", qtyTone)}>
        {formatCompanyNumber(unbookedQty, company)} {uom}
      </td>
      <td className="px-2 py-1.5 text-right font-mono">
        {unitCost ? formatCompanyMoney(unitCost, company) : "—"}
      </td>
      <td className={cn("px-2 py-1.5 text-right font-mono", qtyTone)}>
        {lineTotal ? formatCompanyMoney(lineTotal, company) : "—"}
      </td>
      <td className="px-2 py-1.5 text-muted-foreground/60">—</td>
      <td className="px-2 py-1.5">
        {awaiting ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-inset ring-sky-300 dark:text-sky-300 dark:ring-sky-700">
            <span className="size-1.5 rounded-full bg-sky-500" aria-hidden />
            Sent to procurement
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive ring-1 ring-inset ring-destructive/30">
            <span className="size-1.5 rounded-full bg-destructive" aria-hidden />
            Not booked
          </span>
        )}
      </td>
      <td className="px-2 py-1.5 text-muted-foreground/60">—</td>
      <td className="px-2 py-1.5 text-muted-foreground/60">—</td>
      <td className="px-2 py-1.5 text-muted-foreground/60">—</td>
      <td className="px-1 py-1 text-right">
        {canEdit && (
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={onAddBooking}
              aria-label="Book from stock"
              title="Book from stock"
            >
              <Plus />
            </Button>
            {part.part?.item_type === "semi_finished" && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={onAddSubMo}
                aria-label="Add a sub-MO"
                title="Add a sub-MO"
                className="text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/30"
              >
                <Factory />
              </Button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

interface PendingSubMoRowProps {
  child: ManufacturingOrderRelation;
  uom: string;
  unitCost: string | null;
  company: CompanyDefaults;
  canEdit: boolean;
  onRelease: () => void;
}

function PendingSubMoRow({
  child,
  uom,
  unitCost,
  company,
  canEdit,
  onRelease,
}: PendingSubMoRowProps) {
  const lineTotal =
    unitCost && child.quantity
      ? String(Number(unitCost) * Number(child.quantity))
      : null;

  return (
    <tr className="border-b border-border/40 bg-amber-50/30 dark:bg-amber-950/10">
      <td className="px-2 py-1.5 pl-8">
        <Link
          href={`/production/manufacturing-orders/${child.uuid}`}
          className="inline-flex items-center gap-1.5 text-xs text-amber-800 hover:underline dark:text-amber-300"
        >
          <Factory className="size-3" />
          From {child.code ?? `MO #${child.id}`}
        </Link>
      </td>
      <td className="px-2 py-1.5 text-right" />
      <td className="px-2 py-1.5 text-right font-mono">{`0 ${uom}`.trim()}</td>
      <td className="px-2 py-1.5 text-right font-mono text-amber-800 dark:text-amber-300">
        {formatCompanyNumber(child.quantity, company)} {uom}
      </td>
      <td className="px-2 py-1.5 text-right font-mono">
        {unitCost ? formatCompanyMoney(unitCost, company) : "—"}
      </td>
      <td className="px-2 py-1.5 text-right font-mono">
        {lineTotal ? formatCompanyMoney(lineTotal, company) : "—"}
      </td>
      <td className="px-2 py-1.5 font-mono text-muted-foreground/70">
        (sub-MO)
      </td>
      <td className="px-2 py-1.5">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50",
          )}
        >
          <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden />
          Awaiting production
        </span>
      </td>
      <td className="px-2 py-1.5 text-muted-foreground/60">—</td>
      <td className="px-2 py-1.5 text-muted-foreground/60">—</td>
      <td className="px-2 py-1.5 text-muted-foreground/60">—</td>
      <td className="px-1 py-1 text-right">
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onRelease}
            aria-label="Release / adjust sub-MO"
            title="Release or adjust this sub-MO"
          >
            <RotateCcw />
          </Button>
        )}
      </td>
    </tr>
  );
}

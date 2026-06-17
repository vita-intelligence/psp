"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
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
import {
  bookAllPartsAction,
  releaseAllPartsAction,
} from "@/lib/production/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type { CompanyDefaults } from "@/lib/types";
import type {
  ManufacturingOrder,
  ManufacturingOrderBooking,
  ManufacturingOrderPart,
} from "@/lib/production/types";
import { AddBookingDialog } from "./add-booking-dialog";
import { ReleaseBookingDialog } from "./release-booking-dialog";

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

  function onBookAll() {
    if (!canEdit) return;
    startTransitionAll(async () => {
      const res = await bookAllPartsAction(mo.uuid);
      if (res.ok) {
        toast.success(
          res.created === 0
            ? "Nothing more to book — already covered."
            : `${res.created} booking${res.created === 1 ? "" : "s"} created.`,
        );
        invalidateAudit("manufacturing_order", mo.id);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  function onReleaseAll() {
    if (!canEdit) return;
    if (
      !window.confirm(
        "Release every active booking on this MO? Stock goes back to its lots.",
      )
    ) {
      return;
    }
    startTransitionAll(async () => {
      const res = await releaseAllPartsAction(mo.uuid);
      if (res.ok) {
        toast.success(
          res.released === 0
            ? "Nothing to release."
            : `${res.released} booking${res.released === 1 ? "" : "s"} released.`,
        );
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
            onClick={onBookAll}
          >
            {pendingAll ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
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
              <RotateCcw className="size-3.5" />
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
              <th className="px-2 py-1.5 text-left">Storage</th>
              <th className="px-2 py-1.5 text-left">Available from</th>
              <th className="w-8 px-2 py-1.5" aria-label="Actions" />
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
    </section>
  );
}

interface PartRowsProps {
  p: ManufacturingOrderPart;
  company: CompanyDefaults;
  canEdit: boolean;
  onAdd: () => void;
  onRelease: (b: ManufacturingOrderBooking) => void;
}

function PartRows({ p, company, canEdit, onAdd, onRelease }: PartRowsProps) {
  const hasBookings = p.bookings.length > 0;
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
        <td className="px-1 py-1 text-right">
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={onAdd}
              aria-label="Add a booking"
              title="Add a booking"
            >
              <Plus />
            </Button>
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
    </>
  );
}

function UnderBookedBadge({ p }: { p: ManufacturingOrderPart }) {
  if (!p.required_qty) return <span className="text-muted-foreground/50">—</span>;
  const required = Number(p.required_qty);
  const booked = Number(p.booked_qty ?? "0");
  if (Number.isNaN(required) || Number.isNaN(booked)) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  if (booked === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-destructive">
        Not booked
      </span>
    );
  }
  if (booked >= required) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
        Fully booked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
      Partial
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
    <tr className={cn("border-b border-border/40", "text-amber-700 dark:text-amber-300")}>
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
        {booking.stock_lot?.code ?? "—"}
      </td>
      <td className="px-2 py-1.5 capitalize">{booking.status}</td>
      <td className="px-2 py-1.5">
        {booking.storage_location?.name ?? "—"}
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

"use client";

/**
 * Desktop per-MO preflight detail. Mirrors the mobile per-booking
 * flow (`/m/preflight/[mo_uuid]`) but laid out as a table-ish list
 * where the operator can see every booking at a glance, expand any
 * row to enter qty + notes, and sign them off one by one. The
 * underlying server action + BE endpoint are shared between desktop
 * and mobile — only the rendering differs.
 */

import { useCallback, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Loader2,
  RefreshCw,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import { confirmBookingReceivedAction } from "@/lib/production-preflight/actions";
import type {
  ManufacturingOrder,
  ManufacturingOrderBooking,
} from "@/lib/production/types";

interface Props {
  initialMo: ManufacturingOrder;
  initialBookings: ManufacturingOrderBooking[];
  initialPreflightComplete: boolean;
  companyDateFormat: FormatPrefs | null;
}

export function PreflightMoDetail({
  initialMo,
  initialBookings,
  initialPreflightComplete,
  companyDateFormat,
}: Props) {
  const [mo] = useState<ManufacturingOrder>(initialMo);
  const [bookings, setBookings] =
    useState<ManufacturingOrderBooking[]>(initialBookings);
  const [preflightComplete, setPreflightComplete] = useState(
    initialPreflightComplete,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/m/preflight/${mo.uuid}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setErrorDetail(`Couldn't refresh (${res.status}).`);
        return;
      }
      const body = (await res.json()) as {
        mo: ManufacturingOrder;
        bookings: ManufacturingOrderBooking[];
        preflight_complete: boolean;
      };
      setBookings(body.bookings);
      setPreflightComplete(body.preflight_complete);
      setErrorDetail(null);
    } catch {
      setErrorDetail("Network blip — try again.");
    } finally {
      setIsRefreshing(false);
    }
  }, [mo.uuid]);

  function onBookingUpdated(
    updated: ManufacturingOrderBooking,
    complete: boolean,
  ) {
    setBookings((prev) =>
      prev.map((b) => (b.uuid === updated.uuid ? updated : b)),
    );
    setPreflightComplete(complete);
  }

  const pendingCount = useMemo(
    () => bookings.filter((b) => !b.received_at).length,
    [bookings],
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {pendingCount === 0
            ? `Every line verified (${bookings.length}).`
            : `${pendingCount} of ${bookings.length} line${bookings.length === 1 ? "" : "s"} awaiting sign-off.`}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 size-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {errorDetail && <ErrorBanner detail={errorDetail} />}

      {preflightComplete && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">All ingredients verified</p>
            <p className="text-[12px] opacity-80">
              Production is cleared to start. Flip status to In progress
              from the MO detail or schedule once you&apos;re ready.
            </p>
          </div>
        </div>
      )}

      {!preflightComplete && pendingCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">
              {pendingCount} booking{pendingCount === 1 ? "" : "s"} still to
              sign off
            </p>
            <p className="text-[12px] opacity-80">
              Production can&apos;t transition to In progress until every
              raw-material / packaging booking is verified.
            </p>
          </div>
        </div>
      )}

      {mo.pickup_completed_at && (
        <div className="rounded-lg border border-border/60 bg-card px-4 py-2 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Truck className="size-3" />
            Warehouse picker dropped {bookings.length} lot
            {bookings.length === 1 ? "" : "s"} on{" "}
            {formatCompanyDate(mo.pickup_completed_at, companyDateFormat)}
          </span>
        </div>
      )}

      <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card">
        {bookings.map((booking) => (
          <BookingRow
            key={booking.uuid}
            booking={booking}
            moUuid={mo.uuid}
            companyDateFormat={companyDateFormat}
            onUpdated={onBookingUpdated}
          />
        ))}
      </ul>
    </section>
  );
}

interface BookingRowProps {
  booking: ManufacturingOrderBooking;
  moUuid: string;
  companyDateFormat: FormatPrefs | null;
  onUpdated: (
    updated: ManufacturingOrderBooking,
    preflightComplete: boolean,
  ) => void;
}

function BookingRow({
  booking,
  moUuid,
  companyDateFormat,
  onUpdated,
}: BookingRowProps) {
  const received = !!booking.received_at;
  const [expanded, setExpanded] = useState<boolean>(!received);
  const [qty, setQty] = useState<string>(
    booking.received_qty ?? booking.quantity,
  );
  const [notes, setNotes] = useState<string>(booking.received_notes ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const uomSymbol = booking.item?.stock_uom?.symbol ?? "ea";
  const uomName = booking.item?.stock_uom?.name ?? null;

  function submit() {
    setError(null);
    const trimmed = qty.trim();
    if (!trimmed || Number.isNaN(Number(trimmed)) || Number(trimmed) <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }
    startTransition(async () => {
      const res = await confirmBookingReceivedAction(moUuid, booking.uuid, {
        received_qty: trimmed,
        received_notes: notes.trim() ? notes.trim() : null,
      });
      if (res.ok) {
        toast.success("Receipt confirmed");
        onUpdated(res.booking, res.preflight_complete);
        setExpanded(false);
        return;
      }
      setError(res.detail ?? "Couldn't confirm receipt.");
    });
  }

  const drift = useMemo(() => {
    if (!received || !booking.received_qty) return null;
    const bookedNum = Number(booking.quantity);
    const recvNum = Number(booking.received_qty);
    if (Number.isNaN(bookedNum) || Number.isNaN(recvNum)) return null;
    const diff = recvNum - bookedNum;
    if (Math.abs(diff) < 0.0001) return null;
    return diff;
  }, [received, booking.received_qty, booking.quantity]);

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            received
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
          )}
        >
          {received ? (
            <CheckCircle2 className="size-2.5" />
          ) : (
            <Clipboard className="size-2.5" />
          )}
          {received ? "Received" : "Pending"}
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium">
            {booking.item?.name ?? "Unknown item"}
          </p>
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
            <span>
              Booked: {booking.quantity} {uomSymbol}
              {uomName ? ` (${uomName})` : ""}
            </span>
            {booking.stock_lot?.code && (
              <span className="font-mono">{booking.stock_lot.code}</span>
            )}
            {received && booking.received_at && booking.received_by && (
              <span>
                Signed off by {booking.received_by.name},{" "}
                {formatCompanyDate(booking.received_at, companyDateFormat)}
              </span>
            )}
          </div>
        </div>

        {drift !== null && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              drift > 0
                ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
            )}
          >
            {drift > 0 ? "+" : ""}
            {drift.toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
            {uomSymbol}
          </span>
        )}

        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-border/60 bg-muted/20 px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label htmlFor={`qty-${booking.uuid}`} className="text-xs">
                Received qty ({uomSymbol})
              </Label>
              <Input
                id={`qty-${booking.uuid}`}
                type="number"
                step="any"
                min={0}
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="h-10"
              />
              <p className="text-[11px] text-muted-foreground">
                Booked {booking.quantity} {uomSymbol}
                {uomName ? ` · ${uomName}` : ""}. Override if the actual
                count differs — drift is recorded for traceability.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`notes-${booking.uuid}`} className="text-xs">
                Quality notes
              </Label>
              <Textarea
                id={`notes-${booking.uuid}`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="e.g. seal intact, colour correct, no off-odour"
                className="text-sm"
              />
            </div>
          </div>

          {error && (
            <div className="mt-3">
              <ErrorBanner detail={error} />
            </div>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(false)}
              disabled={pending}
            >
              {received ? "Close" : "Cancel"}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={pending}
            >
              {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              {received ? "Update receipt" : "Confirm receipt"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

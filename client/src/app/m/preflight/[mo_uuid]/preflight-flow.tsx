"use client";

/**
 * Mobile pre-production receipt flow. After the warehouse picker has
 * dropped ingredients at the production-feed cell, the PRODUCTION
 * operator walks through each booking on this page and signs off:
 *
 *   1. Confirms the actual qty (defaults to booked qty; can diverge
 *      to record drift — e.g. weighing variance on a 50kg sack).
 *   2. Notes any quality observations (free text).
 *   3. Taps "Confirm receipt" → stamps received_at/by/qty/notes on
 *      that booking.
 *
 * Once every raw_material / packaging booking is received, the
 * "Ready for production" banner appears. The MO is then eligible for
 * the `scheduled → in_progress` transition (hard gate on the BE).
 *
 * Idempotent: re-confirming an already-received booking is a no-op
 * by default — the operator can still edit qty / notes in the same
 * panel and re-submit to merge updates.
 */

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
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

export function PreflightFlow({
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
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center justify-between gap-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
          >
            <Link href="/m/preflight" aria-label="Back to preflight queue">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <p className="truncate font-mono text-[11px] uppercase text-muted-foreground">
              {mo.code ?? `MO #${mo.id}`}
            </p>
            <h1 className="truncate text-sm font-semibold tracking-tight">
              {mo.item?.name ?? "Unknown item"}
            </h1>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={isRefreshing}
            aria-label="Refresh"
          >
            <RefreshCw
              className={cn(
                "size-4",
                isRefreshing && "animate-spin text-muted-foreground",
              )}
            />
          </Button>
        </div>
      </header>

      <main className="flex-1 space-y-3 px-3 py-3">
        {errorDetail && <ErrorBanner detail={errorDetail} />}

        {preflightComplete && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">All ingredients verified</p>
              <p className="text-[12px] opacity-80">
                Production is cleared to start this MO. Head over to the
                planner / desk to flip status to In progress.
              </p>
            </div>
          </div>
        )}

        {!preflightComplete && pendingCount > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">
                {pendingCount} booking{pendingCount === 1 ? "" : "s"} awaiting
                sign-off
              </p>
              <p className="text-[12px] opacity-80">
                Weigh / count each ingredient, then tap Confirm receipt.
                Production can&apos;t start until every line is verified.
              </p>
            </div>
          </div>
        )}

        {mo.pickup_completed_at && (
          <div className="rounded-lg border border-border/60 bg-card px-3 py-2 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Truck className="size-3" />
              Picker dropped {bookings.length} lot
              {bookings.length === 1 ? "" : "s"} on{" "}
              {formatCompanyDate(mo.pickup_completed_at, companyDateFormat)}
            </span>
          </div>
        )}

        <ul className="space-y-2">
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
      </main>
    </div>
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
    <li
      className={cn(
        "rounded-xl border bg-card",
        received ? "border-emerald-500/40" : "border-border/60",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-3 text-left"
      >
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {received ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-2.5" />
                Received
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                <Clipboard className="size-2.5" />
                Pending
              </span>
            )}
            {drift !== null && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
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
          </div>

          <p className="truncate text-sm font-medium">
            {booking.item?.name ?? "Unknown item"}
          </p>

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
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
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border/60 px-3 py-3">
          <div className="space-y-1.5">
            <Label htmlFor={`qty-${booking.uuid}`} className="text-xs">
              Received qty ({uomSymbol})
            </Label>
            <Input
              id={`qty-${booking.uuid}`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(",", "."))}
              className="h-11 font-mono text-base"
            />
            <p className="text-[11px] text-muted-foreground">
              Booked {booking.quantity} {uomSymbol}
              {uomName ? ` · ${uomName}` : ""}. Override if the actual count
              differs — drift is recorded for traceability.
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

          {error && <ErrorBanner detail={error} />}

          <div className="flex justify-end gap-2">
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

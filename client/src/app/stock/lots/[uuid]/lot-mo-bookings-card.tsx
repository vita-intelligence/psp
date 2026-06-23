"use client";

/**
 * Reverse view of the production chain: every MO that reserved this
 * lot as an input, with the three-stamp lifecycle (picker → pre-prod
 * confirm → consume). Empty when the lot was never booked by any MO.
 */

import Link from "next/link";
import { Factory, PackageMinus, PackageOpen, Truck } from "lucide-react";
import type { StockLotMoBooking } from "@/lib/types";
import {
  formatCompanyDate,
  formatCompanyNumber,
  type FormatPrefs,
} from "@/lib/format/company";
import { UserAvatar } from "@/components/users/user-avatar";

const STATUS_TONE: Record<string, string> = {
  requested: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  consumed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-muted text-muted-foreground",
  released: "bg-muted text-muted-foreground",
};

export function LotMoBookingsCard({
  bookings,
  uomSymbol,
  prefs,
}: {
  bookings: StockLotMoBooking[];
  uomSymbol: string;
  prefs: FormatPrefs;
}) {
  if (bookings.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center gap-2">
        <Factory className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">
          Production bookings
        </h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {bookings.length}
        </span>
      </header>

      <ul className="space-y-3">
        {bookings.map((b) => (
          <li
            key={b.uuid}
            className="rounded-md border border-border/60 bg-card/60 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {b.mo ? (
                  <Link
                    href={`/production/manufacturing-orders/${b.mo.uuid}`}
                    className="font-mono text-xs font-semibold text-brand hover:underline"
                  >
                    {b.mo.code ?? `MO #${b.mo.id}`}
                  </Link>
                ) : (
                  <span className="font-mono text-xs text-muted-foreground">
                    MO #?
                  </span>
                )}
                {b.mo && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="uppercase tracking-wider">MO</span>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 font-semibold text-foreground">
                      {b.mo.status}
                    </span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="uppercase tracking-wider">Booking</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 font-semibold ${STATUS_TONE[b.status] ?? "bg-muted text-muted-foreground"}`}
                  >
                    {b.status}
                  </span>
                </span>
              </div>
              <span className="font-mono text-sm font-semibold">
                {formatCompanyNumber(b.quantity, prefs)} {uomSymbol}
              </span>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Stamp
                icon={Truck}
                label="Picked"
                actor={b.picked_by}
                at={b.picked_at}
                prefs={prefs}
              />
              <Stamp
                icon={PackageOpen}
                label="Confirmed"
                actor={b.received_by}
                at={b.received_at}
                detail={
                  b.received_qty
                    ? `${formatCompanyNumber(b.received_qty, prefs)} ${uomSymbol}`
                    : null
                }
                note={b.received_notes}
                prefs={prefs}
              />
              <Stamp
                icon={PackageMinus}
                label="Consumed"
                actor={b.consumed_by}
                at={b.consumed_at}
                detail={
                  Number(b.consumed_quantity) > 0
                    ? `${formatCompanyNumber(b.consumed_quantity, prefs)} ${uomSymbol}`
                    : null
                }
                prefs={prefs}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stamp({
  icon: Icon,
  label,
  actor,
  at,
  detail,
  note,
  prefs,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  actor: { id: number; name: string; email: string; avatar?: string | null } | null;
  at: string | null;
  detail?: string | null;
  note?: string | null;
  prefs: FormatPrefs;
}) {
  if (!at || !actor) {
    return (
      <div className="rounded-md border border-dashed border-border/40 bg-muted/20 px-2.5 py-1.5">
        <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Icon className="size-3" />
          {label}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Pending</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border/40 bg-muted/30 px-2.5 py-1.5">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </p>
      <div className="mt-0.5 flex items-center gap-1.5">
        <UserAvatar
          name={actor.name}
          email={actor.email}
          avatar={actor.avatar ?? null}
          sizeClassName="size-4"
          fallbackClassName="text-[8px]"
        />
        <span className="text-[11px] font-medium">{actor.name}</span>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {formatCompanyDate(at, prefs)}
      </p>
      {detail && (
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          {detail}
        </p>
      )}
      {note && (
        <p className="mt-0.5 text-[10px] italic text-muted-foreground">
          “{note}”
        </p>
      )}
    </div>
  );
}

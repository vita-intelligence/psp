"use client";

/**
 * Client-side tab bodies for the mobile 3PL hub. Each tab wraps its
 * row renderer in the shared ``<InfiniteList>`` so search + infinite
 * scroll are uniform across the hub. Server component (`page.tsx`)
 * fetches the first page + hands it in as `initial*` props so the
 * initial paint has no client-side round-trip.
 */

import Link from "next/link";
import { useCallback } from "react";
import {
  ClipboardList,
  MailCheck,
  MapPin,
  Package,
  ShieldCheck,
  Truck,
  Undo2,
} from "lucide-react";

import type {
  BaileeShipmentRow,
  PendingDispatch,
  PendingReturn,
  ThreePLListPage,
  ThreePLListParams,
} from "@/lib/three-pl/types";

import { CancelRowButton } from "./cancel-row-button";
import { InfiniteList } from "./infinite-list";
import { SendLabelToLaptopButton } from "./send-label-button";

// -----------------------------------------------------------------
// Move tab
// -----------------------------------------------------------------

export function MoveTabClient({
  initial,
}: {
  initial: ThreePLListPage<PendingDispatch>;
}) {
  const fetchPage = useCallback(
    (params: { q: string; cursor: string | null }) =>
      fetchList<PendingDispatch>("/api/three-pl/dispatch-requests", params),
    [],
  );

  return (
    <InfiniteList<PendingDispatch>
      initialItems={initial.items}
      initialNextCursor={initial.next_cursor}
      fetchPage={fetchPage}
      renderItem={(row) => <MoveRow key={row.uuid} row={row} />}
      emptyState={
        <EmptyState
          title="Nothing to move right now"
          detail="Customer-requested dispatches land here for the picker to walk into the shipping bay."
        />
      }
      searchPlaceholder="Search moves — product, lot, customer…"
      storageKey="three-pl:move:q"
    />
  );
}

function MoveRow({ row }: { row: PendingDispatch }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <Link
        href={`/m/three-pl-dispatches/${encodeURIComponent(row.uuid)}`}
        className="block p-3 active:bg-muted"
      >
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-300">
            <Truck className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {row.qty}
              {row.lot?.unit_symbol ? ` ${row.lot.unit_symbol}` : ""} of{" "}
              {row.lot?.item?.name ?? "—"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              Held for {row.lot?.bailee_customer?.name ?? "—"}
              {row.reference ? ` · ref ${row.reference}` : ""}
            </p>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Package className="size-3" />
            <span className="font-mono">{row.lot?.code ?? "—"}</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="size-3" />
            {sourceLabel(row.source_location, row.source_cell)}
          </div>
        </div>
        {row.notes && (
          <p className="mt-2 rounded-md bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
            {row.notes}
          </p>
        )}
      </Link>
      <div className="flex items-center justify-end gap-2 border-t border-border/60 p-2">
        <SendLabelToLaptopButton
          dispatch_uuid={row.uuid}
          customer_name={row.lot?.bailee_customer?.name ?? null}
          item_name={row.lot?.item?.name ?? null}
          lot_code={row.lot?.code ?? null}
          qty={row.qty}
          uom_symbol={row.lot?.unit_symbol ?? null}
          reference={row.reference ?? null}
        />
        <CancelRowButton kind="dispatch" uuid={row.uuid} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------
// Paperwork tab
// -----------------------------------------------------------------

export function PaperworkTabClient({
  initial,
}: {
  initial: ThreePLListPage<BaileeShipmentRow>;
}) {
  const fetchPage = useCallback(
    (params: { q: string; cursor: string | null }) =>
      fetchList<BaileeShipmentRow>(
        "/api/three-pl/shipments/needing-paperwork",
        params,
      ),
    [],
  );

  return (
    <InfiniteList<BaileeShipmentRow>
      initialItems={initial.items}
      initialNextCursor={initial.next_cursor}
      fetchPage={fetchPage}
      renderItem={(s) => <PaperworkRow key={s.uuid} row={s} />}
      emptyState={
        <EmptyState
          title="No paperwork owed"
          detail="After you walk a bailee lot to the shipping bay, its draft shipment lands here so someone can review the recipient / address / planned ship date and mark it Ready."
        />
      }
      searchPlaceholder="Search paperwork — product, lot, customer, recipient…"
      storageKey="three-pl:paperwork:q"
    />
  );
}

function PaperworkRow({ row: s }: { row: BaileeShipmentRow }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <Link
        href={`/m/shipments/${encodeURIComponent(s.uuid)}/paperwork`}
        className="block p-3 active:bg-muted"
      >
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <ClipboardList className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {s.qty}
              {s.lot?.unit_symbol ? ` ${s.lot.unit_symbol}` : ""} of{" "}
              {s.lot?.item?.name ?? "—"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              For {s.customer?.name ?? "—"}
            </p>
          </div>
          <StatusPill status={s.status} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Fill shipping form → Mark ready for pickup.
        </p>
      </Link>
      <div className="flex items-center justify-end gap-2 border-t border-border/60 p-2">
        {s.dispatch_uuid && (
          <SendLabelToLaptopButton
            dispatch_uuid={s.dispatch_uuid}
            customer_name={s.customer?.name ?? null}
            item_name={s.lot?.item?.name ?? null}
            lot_code={s.lot?.code ?? null}
            qty={s.qty}
            uom_symbol={s.lot?.unit_symbol ?? null}
            reference={null}
          />
        )}
        <CancelRowButton kind="shipment" uuid={s.uuid} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------
// Pickup tab
// -----------------------------------------------------------------

export function PickupTabClient({
  initial,
}: {
  initial: ThreePLListPage<BaileeShipmentRow>;
}) {
  const fetchPage = useCallback(
    (params: { q: string; cursor: string | null }) =>
      fetchList<BaileeShipmentRow>(
        "/api/three-pl/shipments/awaiting-pickup",
        params,
      ),
    [],
  );

  return (
    <InfiniteList<BaileeShipmentRow>
      initialItems={initial.items}
      initialNextCursor={initial.next_cursor}
      fetchPage={fetchPage}
      renderItem={(s) => <PickupRow key={s.uuid} row={s} />}
      emptyState={
        <EmptyState
          title="No pickups queued"
          detail="Shipments marked Ready land here so the truck arrival can be logged with driver / vehicle / checklist / loading photos."
        />
      }
      searchPlaceholder="Search pickups — product, lot, carrier, tracking…"
      storageKey="three-pl:pickup:q"
    />
  );
}

function PickupRow({ row: s }: { row: BaileeShipmentRow }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <Link
        href={`/m/shipments/${encodeURIComponent(s.uuid)}/dispatch`}
        className="block p-3 active:bg-muted"
      >
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-brand/10 text-brand">
            <ShieldCheck className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {s.qty}
              {s.lot?.unit_symbol ? ` ${s.lot.unit_symbol}` : ""} of{" "}
              {s.lot?.item?.name ?? "—"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              For {s.customer?.name ?? "—"}
              {s.carrier ? ` · ${s.carrier}` : ""}
            </p>
          </div>
          <StatusPill status={s.status} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Package className="size-3" />
            <span className="font-mono">{s.lot?.code ?? "—"}</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <MailCheck className="size-3" />
            {s.status === "partially_picked"
              ? "Next truck arriving"
              : `Ready since ${formatShort(s.ready_at)}`}
          </div>
        </div>
      </Link>
      <div className="flex items-center justify-end gap-2 border-t border-border/60 p-2">
        {s.dispatch_uuid && (
          <SendLabelToLaptopButton
            dispatch_uuid={s.dispatch_uuid}
            customer_name={s.customer?.name ?? null}
            item_name={s.lot?.item?.name ?? null}
            lot_code={s.lot?.code ?? null}
            qty={s.qty}
            uom_symbol={s.lot?.unit_symbol ?? null}
            reference={null}
          />
        )}
        <CancelRowButton kind="shipment" uuid={s.uuid} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------
// Confirm tab
// -----------------------------------------------------------------

export function ConfirmTabClient({
  initial,
}: {
  initial: ThreePLListPage<BaileeShipmentRow>;
}) {
  const fetchPage = useCallback(
    (params: { q: string; cursor: string | null }) =>
      fetchList<BaileeShipmentRow>(
        "/api/three-pl/shipments/in-transit",
        params,
      ),
    [],
  );

  return (
    <InfiniteList<BaileeShipmentRow>
      initialItems={initial.items}
      initialNextCursor={initial.next_cursor}
      fetchPage={fetchPage}
      renderItem={(s) => <ConfirmRow key={s.uuid} row={s} />}
      emptyState={
        <EmptyState
          title="Nothing in transit"
          detail="Shipments the truck has already picked up appear here while we wait for the customer to confirm delivery on their portal."
        />
      }
      searchPlaceholder="Search in-transit — product, lot, tracking…"
      storageKey="three-pl:confirm:q"
    />
  );
}

function ConfirmRow({ row: s }: { row: BaileeShipmentRow }) {
  const pickedUp = Number(s.picked_up_qty ?? "0");
  const total = Number(s.qty ?? "0");
  const percent =
    total > 0 ? Math.min(100, Math.round((pickedUp / total) * 100)) : 0;
  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <Link
        href={`/m/shipments/${encodeURIComponent(s.uuid)}/dispatch`}
        className="block p-3 active:bg-muted"
      >
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <MailCheck className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {s.qty}
              {s.lot?.unit_symbol ? ` ${s.lot.unit_symbol}` : ""} of{" "}
              {s.lot?.item?.name ?? "—"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              For {s.customer?.name ?? "—"}
              {s.tracking_number ? ` · ${s.tracking_number}` : ""}
            </p>
          </div>
          <StatusPill status={s.status} />
        </div>
        {s.status === "partially_picked" && total > 0 && (
          <div className="mt-2">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>
                {pickedUp.toLocaleString()} of {total.toLocaleString()} picked up
              </span>
              <span className="font-medium">{percent}%</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={
                  percent === 100 ? "h-full bg-emerald-500" : "h-full bg-brand"
                }
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Picked up {formatShort(s.picked_up_at) || "—"}. Customer will confirm
          delivery on the portal.
        </p>
      </Link>
      {s.dispatch_uuid && (
        <div className="flex justify-end border-t border-border/60 p-2">
          <SendLabelToLaptopButton
            dispatch_uuid={s.dispatch_uuid}
            customer_name={s.customer?.name ?? null}
            item_name={s.lot?.item?.name ?? null}
            lot_code={s.lot?.code ?? null}
            qty={s.qty}
            uom_symbol={s.lot?.unit_symbol ?? null}
            reference={null}
          />
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------
// Return tab
// -----------------------------------------------------------------

export function ReturnTabClient({
  initial,
}: {
  initial: ThreePLListPage<PendingReturn>;
}) {
  const fetchPage = useCallback(
    (params: { q: string; cursor: string | null }) =>
      fetchList<PendingReturn>("/api/three-pl/returns", params),
    [],
  );

  return (
    <InfiniteList<PendingReturn>
      initialItems={initial.items}
      initialNextCursor={initial.next_cursor}
      fetchPage={fetchPage}
      renderItem={(row) => <ReturnRow key={row.uuid} row={row} />}
      emptyState={
        <EmptyState
          title="Nothing to return"
          detail="When a Paperwork or Pickup shipment gets cancelled, its lot lands here so the picker can walk it back to bailee custody."
        />
      }
      searchPlaceholder="Search returns — product, lot, customer…"
      storageKey="three-pl:return:q"
    />
  );
}

function ReturnRow({ row }: { row: PendingReturn }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <Link
        href={`/m/three-pl-returns/${encodeURIComponent(row.uuid)}`}
        className="block p-3 active:bg-muted"
      >
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-orange-500/10 text-orange-700 dark:text-orange-300">
            <Undo2 className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {row.qty}
              {row.lot?.unit_symbol ? ` ${row.lot.unit_symbol}` : ""} of{" "}
              {row.lot?.item?.name ?? "—"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              Return to {row.lot?.bailee_customer?.name ?? "—"}&apos;s bailee stock
            </p>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <div className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="size-3" />
            From {sourceLabel(row.source_location, row.source_cell)}
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Undo2 className="size-3" />
            Back to{" "}
            {row.return_target
              ? row.return_target.name ??
                row.return_target.code ??
                "3PL cell"
              : "any 3PL cell"}
          </div>
        </div>
      </Link>
      <div className="flex justify-end border-t border-border/60 p-2">
        <SendLabelToLaptopButton
          dispatch_uuid={row.uuid}
          customer_name={row.lot?.bailee_customer?.name ?? null}
          item_name={row.lot?.item?.name ?? null}
          lot_code={row.lot?.code ?? null}
          qty={row.qty}
          uom_symbol={row.lot?.unit_symbol ?? null}
          reference={row.reference ?? null}
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------
// Shared bits
// -----------------------------------------------------------------

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-card p-4 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function StatusPill({ status }: { status: BaileeShipmentRow["status"] }) {
  const cls =
    status === "draft"
      ? "bg-muted text-muted-foreground"
      : status === "ready"
        ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
        : status === "partially_picked"
          ? "bg-brand/15 text-brand"
          : status === "picked_up"
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            : "bg-muted text-muted-foreground";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function sourceLabel(
  loc: { name: string | null; code: string | null } | null,
  cell: {
    name: string | null;
    code: string | null;
    ordinal: number;
  } | null,
): string {
  const locPart = loc?.name?.trim() || loc?.code?.trim() || "—";
  const cellPart =
    cell?.name?.trim() ||
    cell?.code?.trim() ||
    (typeof cell?.ordinal === "number" ? `Level ${cell.ordinal + 1}` : null);
  return cellPart ? `${locPart} · ${cellPart}` : locPart;
}

function formatShort(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// Client-side fetch — hits the Next.js proxy route (which forwards
// the cookie-authed device / session token to Phoenix). Falls
// through empty on 401/500/network so a rocky office wifi doesn't
// blank the list.
async function fetchList<T>(
  base: string,
  params: { q: string; cursor: string | null; limit?: number },
): Promise<ThreePLListPage<T>> {
  const url = new URL(base, window.location.origin);
  const qs = buildParams({
    q: params.q || null,
    cursor: params.cursor,
    limit: params.limit ?? null,
  });
  url.search = qs;
  const res = await fetch(url.toString(), {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ThreePLListPage<T>;
}

function buildParams(p: ThreePLListParams): string {
  const s = new URLSearchParams();
  const q = p.q?.trim();
  if (q) s.set("q", q);
  if (p.cursor) s.set("cursor", p.cursor);
  if (p.limit) s.set("limit", String(p.limit));
  return s.toString();
}

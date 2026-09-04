import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronLeft,
  ClipboardList,
  MailCheck,
  MapPin,
  Package,
  ShieldCheck,
  Truck,
  Undo2,
} from "lucide-react";
import { getDeviceToken } from "@/lib/devices/server";
import {
  listBaileeShipmentsAwaitingPickup,
  listBaileeShipmentsInTransit,
  listBaileeShipmentsNeedingPaperwork,
  listPendingDispatches,
  listPendingReturns,
} from "@/lib/three-pl/server";
import type {
  BaileeShipmentRow,
  PendingDispatch,
  PendingReturn,
} from "@/lib/three-pl/types";
import { CancelRowButton } from "./cancel-row-button";
import { SendLabelToLaptopButton } from "./send-label-button";

export const metadata = { title: "3PL dispatches · PSP Mobile" };
export const dynamic = "force-dynamic";

type Tab = "move" | "paperwork" | "pickup" | "confirm" | "return";

/**
 * Mobile 3PL hub — a four-tab view of every bailee-flow shipment a
 * picker touches during its lifetime. Same operator persona owns
 * all four tabs (three_pl.dispatch_execute):
 *
 *   1. Move — pending 3PL Dispatch rows waiting for the picker to
 *      walk the lot from a bailee cell into a dispatch cell. Tap →
 *      the existing walk-flow at /m/three-pl-dispatches/[uuid].
 *   2. Paperwork — draft Shipments born from that walk that still
 *      owe a shipping-form review (recipient / address / country /
 *      planned ship date) before being marked Ready. Tap →
 *      /m/shipments/[uuid]/paperwork.
 *   3. Pickup — ready / partially_picked Shipments waiting on the
 *      truck. Tap → /m/shipments/[uuid]/dispatch, the standard
 *      mobile pickup-event form (carrier, driver, vehicle
 *      registration, checklist, loading photos, seal + temperature).
 *   4. Confirm — picked_up shipments in transit, waiting on the
 *      customer to sign delivery off on their portal. Read-only —
 *      customer owns the next action.
 */
export default async function MobileThreePlDispatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const [pending, paperwork, awaitingPickup, inTransit, returns] =
    await Promise.all([
      listPendingDispatches(),
      listBaileeShipmentsNeedingPaperwork(),
      listBaileeShipmentsAwaitingPickup(),
      listBaileeShipmentsInTransit(),
      listPendingReturns(),
    ]);

  const { tab } = await searchParams;
  const active = normaliseTab(tab);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-3">
        <Link
          href="/m"
          className="rounded-md p-1.5 text-muted-foreground active:bg-muted"
          aria-label="Back to home"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-wider text-muted-foreground">
            3PL dispatches
          </p>
          <p className="truncate text-sm font-semibold">
            {pending.length +
              paperwork.length +
              awaitingPickup.length +
              inTransit.length +
              returns.length}{" "}
            in flight
          </p>
        </div>
      </header>

      <nav
        className="flex border-b border-border/60 text-xs"
        aria-label="3PL flow stage"
      >
        <TabLink
          tab="move"
          active={active}
          icon={<Truck />}
          label="Move"
          count={pending.length}
        />
        <TabLink
          tab="paperwork"
          active={active}
          icon={<ClipboardList />}
          label="Paperwork"
          count={paperwork.length}
        />
        <TabLink
          tab="pickup"
          active={active}
          icon={<ShieldCheck />}
          label="Pickup"
          count={awaitingPickup.length}
        />
        <TabLink
          tab="confirm"
          active={active}
          icon={<MailCheck />}
          label="Confirm"
          count={inTransit.length}
        />
        <TabLink
          tab="return"
          active={active}
          icon={<Undo2 />}
          label="Return"
          count={returns.length}
        />
      </nav>

      <main className="flex-1 space-y-3 px-3 py-4">
        {active === "move" && <MoveTab items={pending} />}
        {active === "paperwork" && <PaperworkTab items={paperwork} />}
        {active === "pickup" && <PickupTab items={awaitingPickup} />}
        {active === "confirm" && <ConfirmTab items={inTransit} />}
        {active === "return" && <ReturnTab items={returns} />}
      </main>
    </div>
  );
}

function normaliseTab(raw: string | undefined): Tab {
  if (
    raw === "paperwork" ||
    raw === "pickup" ||
    raw === "confirm" ||
    raw === "return"
  )
    return raw;
  return "move";
}

function TabLink({
  tab,
  active,
  icon,
  label,
  count,
}: {
  tab: Tab;
  active: Tab;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  const isActive = active === tab;
  return (
    <Link
      href={`/m/three-pl-dispatches${tab === "move" ? "" : `?tab=${tab}`}`}
      className={`relative flex flex-1 items-center justify-center px-2 py-3 border-b-2 transition-colors ${
        isActive
          ? "border-brand text-brand"
          : "border-transparent text-muted-foreground active:bg-muted"
      }`}
      role="tab"
      aria-selected={isActive}
      aria-label={`${label} (${count})`}
      title={label}
    >
      <span className="[&_svg]:size-5">{icon}</span>
      {count > 0 && (
        <span
          className={`absolute -top-0.5 right-1 min-w-[1.1rem] rounded-full border border-background px-1 text-[9px] font-semibold leading-4 tabular-nums text-center ${
            isActive ? "bg-brand text-brand-foreground" : "bg-muted-foreground/60 text-background"
          }`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------
// Tab 1 — Move
// ---------------------------------------------------------------

function MoveTab({ items }: { items: PendingDispatch[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing to move right now"
        detail="Customer-requested dispatches land here for the picker to walk into the shipping bay."
      />
    );
  }
  return (
    <>
      {items.map((row) => (
        <div key={row.uuid} className="rounded-lg border border-border/60 bg-card">
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
      ))}
    </>
  );
}

// ---------------------------------------------------------------
// Tab 2 — Paperwork
// ---------------------------------------------------------------

function PaperworkTab({ items }: { items: BaileeShipmentRow[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No paperwork owed"
        detail="After you walk a bailee lot to the shipping bay, its draft shipment lands here so someone can review the recipient / address / planned ship date and mark it Ready."
      />
    );
  }
  return (
    <>
      {items.map((s) => (
        <div key={s.uuid} className="rounded-lg border border-border/60 bg-card">
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
      ))}
    </>
  );
}

// ---------------------------------------------------------------
// Tab 3 — Pickup
// ---------------------------------------------------------------

function PickupTab({ items }: { items: BaileeShipmentRow[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No pickups queued"
        detail="Shipments marked Ready land here so the truck arrival can be logged with driver / vehicle / checklist / loading photos."
      />
    );
  }
  return (
    <>
      {items.map((s) => (
        <div key={s.uuid} className="rounded-lg border border-border/60 bg-card">
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
      ))}
    </>
  );
}

// ---------------------------------------------------------------
// Tab 4 — Confirm
// ---------------------------------------------------------------

function ConfirmTab({ items }: { items: BaileeShipmentRow[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing in transit"
        detail="Shipments the truck has already picked up appear here while we wait for the customer to confirm delivery on their portal."
      />
    );
  }
  return (
    <>
      {items.map((s) => {
        const pickedUp = Number(s.picked_up_qty ?? "0");
        const total = Number(s.qty ?? "0");
        const percent =
          total > 0 ? Math.min(100, Math.round((pickedUp / total) * 100)) : 0;
        return (
          <div key={s.uuid} className="rounded-lg border border-border/60 bg-card"><Link
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
                    {pickedUp.toLocaleString()} of {total.toLocaleString()}{" "}
                    picked up
                  </span>
                  <span className="font-medium">{percent}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={
                      percent === 100
                        ? "h-full bg-emerald-500"
                        : "h-full bg-brand"
                    }
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Picked up {formatShort(s.picked_up_at) || "—"}. Customer will
              confirm delivery on the portal.
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
      })}
    </>
  );
}

// ---------------------------------------------------------------
// Tab 5 — Return
// ---------------------------------------------------------------

function ReturnTab({ items }: { items: PendingReturn[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing to return"
        detail="When a Paperwork or Pickup shipment gets cancelled, its lot lands here so the picker can walk it back to bailee custody."
      />
    );
  }
  return (
    <>
      {items.map((row) => (
        <div key={row.uuid} className="rounded-lg border border-border/60 bg-card">
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
                  Return to {row.lot?.bailee_customer?.name ?? "—"}&apos;s
                  bailee stock
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
      ))}
    </>
  );
}

// ---------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------

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

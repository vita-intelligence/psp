"use client";

/**
 * Mobile pickup detail + scan flow. Single-operator workflow (no
 * realtime cursor / FieldEditingIndicator inside the scan steps —
 * mirrors the canonical /m/lots/[uuid]/move flow). MO-level
 * head-of-picker lock lives on the BE: once `pickup_started_at` is
 * set, anyone else opening this page sees the lock banner and can't
 * fire actions.
 *
 * Flow:
 *   1. Bookings list (read-only until Start Pickup)
 *   2. Start Pickup confirm modal → POST /api/m/pickup/:uuid/start
 *   3. Per-booking sub-flow: scan cell QR → scan lot QR → mark-picked
 *      (resumable: re-mount lands on next un-picked booking)
 *   4. All bookings picked → "Confirm transfer" button enables
 *   5. Confirm transfer (Phase 5):
 *        a. overview + auto-picked production cell
 *        b. scan production cell QR
 *        c. per-lot photo iteration
 *        d. POST /api/m/pickup/:uuid/confirm-transfer
 *
 * Resume: page re-fetches on mount → state derived from MO's pickup
 * timestamps + bookings' picked_at. No client-side persistence; the
 * BE is the source of truth.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ImagePlus,
  Layers,
  Loader2,
  MapPin,
  Package,
  PackageCheck,
  RefreshCw,
  ScanLine,
  Truck,
  UserCircle2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import {
  abortMoPickupAction,
  confirmPickupTransferAction,
  markBookingPickedAction,
  startMoPickupAction,
} from "@/lib/warehouse-pickup/actions";
import type {
  ManufacturingOrder,
  ManufacturingOrderBooking,
} from "@/lib/production/types";
import { UuidScanStep } from "./uuid-scan-step";
import { FloorPlanMini } from "../../lots/[uuid]/move/floor-plan-mini";
import { LastSeenPhotoCard } from "../../lots/[uuid]/move/last-seen-photo";
import type { ManufacturingOrderBookingCellSummary } from "@/lib/production/types";

interface Props {
  initialMo: ManufacturingOrder;
  initialBookings: ManufacturingOrderBooking[];
  companyDateFormat: FormatPrefs | null;
}

type FlowStep =
  | { kind: "overview" }
  | { kind: "directions"; bookingUuid: string }
  | { kind: "scan_cell"; bookingUuid: string }
  | { kind: "scan_lot"; bookingUuid: string }
  | { kind: "transfer_overview" }
  | { kind: "transfer_directions" }
  | { kind: "transfer_scan_cell" }
  | { kind: "transfer_photos" };

interface ProductionCellChoice {
  uuid: string;
  code: string;
  name?: string | null;
  /** Full breadcrumb so the transfer directions step can render the
   *  warehouse → floor → location row stack + floor-plan mini. */
  location?: {
    uuid: string;
    name: string | null;
    code: string | null;
    floor: {
      uuid: string;
      name: string | null;
      warehouse: { uuid: string; name: string | null } | null;
    } | null;
  } | null;
}

export function PickupFlow({
  initialMo,
  initialBookings,
  companyDateFormat,
}: Props) {
  const router = useRouter();
  const [mo, setMo] = useState<ManufacturingOrder>(initialMo);
  const [bookings, setBookings] =
    useState<ManufacturingOrderBooking[]>(initialBookings);
  const [step, setStep] = useState<FlowStep>({ kind: "overview" });
  const [pending, setPending] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [productionCell, setProductionCell] =
    useState<ProductionCellChoice | null>(null);
  const [photosByBookingUuid, setPhotosByBookingUuid] = useState<
    Record<string, string>
  >({});

  // Pickup lifecycle state
  const lifecycle: PickupLifecycle = useMemo(() => {
    if (mo.pickup_completed_at) return "handed_off";
    if (mo.pickup_started_at) return "in_progress";
    if (mo.released_to_warehouse_at) return "released";
    return "not_released";
  }, [mo]);

  const allPicked = useMemo(
    () =>
      bookings.length > 0 && bookings.every((b) => b.picked_at !== null),
    [bookings],
  );

  const nextPending = useMemo(
    () => bookings.find((b) => b.picked_at === null),
    [bookings],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/m/pickup/${encodeURIComponent(mo.uuid)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const body = (await res.json()) as {
        mo: ManufacturingOrder;
        bookings: ManufacturingOrderBooking[];
      };
      setMo(body.mo);
      setBookings(body.bookings);
    } catch {
      // swallow — refresh is best-effort
    }
  }, [mo.uuid]);

  // Poll while pickup is in progress so peer updates surface.
  useEffect(() => {
    if (lifecycle !== "in_progress") return;
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [lifecycle, refresh]);

  async function handleStartPickup() {
    setPending(true);
    try {
      const res = await startMoPickupAction(mo.uuid);
      if (res.ok) {
        setMo(res.mo);
        setConfirmStart(false);
        toast.success("Pickup started — head to the first cell.");
      } else if (res.code === "not_released") {
        toast.error("This MO isn't released yet.");
      } else if (res.code === "pickup_already_started") {
        toast.error("Pickup is already in progress.");
        void refresh();
      } else {
        toast.error(res.detail ?? "Couldn't start pickup.");
      }
    } finally {
      setPending(false);
    }
  }

  async function handleAbort() {
    setPending(true);
    try {
      const res = await abortMoPickupAction(mo.uuid);
      if (res.ok) {
        setMo(res.mo);
        // Refresh bookings — their picked_at was cleared.
        await refresh();
        setStep({ kind: "overview" });
        setConfirmAbort(false);
        toast.success("Pickup aborted. Items stay on their original cells.");
      } else {
        toast.error(res.detail ?? "Couldn't abort pickup.");
      }
    } finally {
      setPending(false);
    }
  }

  async function handleMarkPicked(
    bookingUuid: string,
    cellUuid: string,
    lotUuid: string,
  ) {
    setPending(true);
    try {
      const res = await markBookingPickedAction(
        mo.uuid,
        bookingUuid,
        lotUuid,
        cellUuid,
      );
      if (res.ok) {
        setBookings((prev) =>
          prev.map((b) =>
            b.uuid === bookingUuid ? { ...b, ...res.booking } : b,
          ),
        );
        toast.success("Picked. Move to the next item.");
        setStep({ kind: "overview" });
      } else if (res.code === "wrong_lot" || res.code === "wrong_cell") {
        toast.error(res.detail ?? "Mismatch — restart this booking.");
        setStep({ kind: "overview" });
      } else {
        toast.error(res.detail ?? "Couldn't mark picked.");
      }
    } finally {
      setPending(false);
    }
  }

  async function handleConfirmTransfer() {
    if (!productionCell) {
      toast.error("Scan the production cell first.");
      return;
    }
    if (
      bookings.some((b) => !photosByBookingUuid[b.uuid]) &&
      step.kind === "transfer_photos"
    ) {
      toast.error("Take a photo for every lot before confirming.");
      return;
    }
    setPending(true);
    try {
      const res = await confirmPickupTransferAction(
        mo.uuid,
        productionCell.uuid,
        photosByBookingUuid,
      );
      if (res.ok) {
        setMo(res.mo);
        toast.success("Transferred to production.");
        router.push("/m/pickup");
      } else if (res.code === "production_cell_not_found") {
        toast.error("Scanned cell wasn't found.");
      } else if (res.code === "production_cell_wrong_purpose") {
        toast.error("That cell isn't a production-feed cell.");
      } else if (res.code === "bookings_not_all_picked") {
        toast.error("Some bookings still aren't picked.");
        await refresh();
        setStep({ kind: "overview" });
      } else {
        toast.error(res.detail ?? "Couldn't complete the transfer.");
      }
    } finally {
      setPending(false);
    }
  }

  // ----- Header (always rendered) -----
  const header = (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex items-center justify-between gap-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
        >
          <Link href="/m/pickup" aria-label="Back to pickup queue">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-tight">
            {mo.code ?? `MO #${mo.id}`}
          </h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {mo.item?.name ?? "Unknown item"} · {mo.quantity} units
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          aria-label="Refresh"
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
    </header>
  );

  // ----- Body switches on flow step -----
  let body: React.ReactNode;

  if (step.kind === "overview") {
    body = (
      <OverviewBody
        mo={mo}
        bookings={bookings}
        lifecycle={lifecycle}
        allPicked={allPicked}
        companyDateFormat={companyDateFormat}
        onStartPickup={() => setConfirmStart(true)}
        onAbort={() => setConfirmAbort(true)}
        onScanBooking={(bookingUuid) =>
          setStep({ kind: "directions", bookingUuid })
        }
        onConfirmTransfer={() => setStep({ kind: "transfer_overview" })}
        pending={pending}
      />
    );
  } else if (step.kind === "directions") {
    const booking = bookings.find((b) => b.uuid === step.bookingUuid);
    if (!booking || !booking.storage_location) {
      body = (
        <div className="px-4 py-4">
          <p className="text-sm text-destructive">
            Booking has no pinned cell. Abort and let the planner re-FEFO.
          </p>
        </div>
      );
    } else {
      body = (
        <DirectionsBody
          headline="Walk to the lot"
          cell={booking.storage_location}
          lotCode={booking.stock_lot?.code ?? null}
          qty={booking.quantity}
          itemName={booking.item?.name ?? null}
          lastPhotoUrl={booking.stock_lot?.last_photo_url ?? null}
          onContinue={() =>
            setStep({ kind: "scan_cell", bookingUuid: booking.uuid })
          }
          onBack={() => setStep({ kind: "overview" })}
        />
      );
    }
  } else if (step.kind === "scan_cell") {
    const booking = bookings.find((b) => b.uuid === step.bookingUuid);
    if (!booking || !booking.storage_location?.uuid) {
      body = (
        <div className="px-4 py-4">
          <p className="text-sm text-destructive">
            Booking has no pinned cell. Abort and let the planner re-FEFO.
          </p>
        </div>
      );
    } else {
      body = (
        <div className="px-4 py-4">
          <UuidScanStep
            expectedUuid={booking.storage_location.uuid}
            kind="cell"
            expectedLabel={
              booking.storage_location.name ??
              `Cell ${booking.storage_location.uuid.slice(0, 8)}`
            }
            onConfirmed={() =>
              setStep({ kind: "scan_lot", bookingUuid: booking.uuid })
            }
            onCancel={() => setStep({ kind: "overview" })}
          />
        </div>
      );
    }
  } else if (step.kind === "scan_lot") {
    const booking = bookings.find((b) => b.uuid === step.bookingUuid);
    if (!booking || !booking.stock_lot?.uuid) {
      body = (
        <div className="px-4 py-4">
          <p className="text-sm text-destructive">
            Booking has no pinned lot. Abort and let the planner re-FEFO.
          </p>
        </div>
      );
    } else {
      body = (
        <div className="px-4 py-4">
          <UuidScanStep
            expectedUuid={booking.stock_lot.uuid}
            kind="lot"
            expectedLabel={
              booking.stock_lot.code ??
              `Lot ${booking.stock_lot.uuid.slice(0, 8)}`
            }
            onConfirmed={() => {
              if (!booking.storage_location?.uuid || !booking.stock_lot?.uuid)
                return;
              void handleMarkPicked(
                booking.uuid,
                booking.storage_location.uuid,
                booking.stock_lot.uuid,
              );
            }}
            onCancel={() => setStep({ kind: "overview" })}
          />
        </div>
      );
    }
  } else if (step.kind === "transfer_overview") {
    body = (
      <TransferOverviewBody
        bookings={bookings}
        companyDateFormat={companyDateFormat}
        productionCell={productionCell}
        onPickCell={(cell) => setProductionCell(cell)}
        onScanCell={() => setStep({ kind: "transfer_directions" })}
        onContinue={() => setStep({ kind: "transfer_photos" })}
        onBack={() => setStep({ kind: "overview" })}
      />
    );
  } else if (step.kind === "transfer_directions") {
    if (!productionCell?.location) {
      body = (
        <div className="px-4 py-4">
          <p className="text-sm text-destructive">
            No production-feed cell selected yet.
          </p>
        </div>
      );
    } else {
      body = (
        <DirectionsBody
          headline="Walk to production-feed cell"
          cell={{
            id: 0,
            uuid: productionCell.uuid,
            name: productionCell.name ?? productionCell.code,
            purpose: "production_feed",
            ordinal: null,
            storage_location: productionCell.location,
          }}
          lotCode={null}
          qty={null}
          itemName={null}
          onContinue={() => setStep({ kind: "transfer_scan_cell" })}
          onBack={() => setStep({ kind: "transfer_overview" })}
        />
      );
    }
  } else if (step.kind === "transfer_scan_cell") {
    body = (
      <div className="px-4 py-4">
        {productionCell ? (
          <UuidScanStep
            expectedUuid={productionCell.uuid}
            kind="cell"
            expectedLabel={productionCell.code}
            onConfirmed={() => setStep({ kind: "transfer_photos" })}
            onCancel={() => setStep({ kind: "transfer_directions" })}
          />
        ) : (
          <p className="text-sm text-destructive">No production cell chosen.</p>
        )}
      </div>
    );
  } else if (step.kind === "transfer_photos") {
    body = (
      <TransferPhotosBody
        bookings={bookings}
        photosByBookingUuid={photosByBookingUuid}
        productionCell={productionCell}
        pending={pending}
        onUploadPhoto={(bookingUuid, photoUrl) =>
          setPhotosByBookingUuid((prev) => ({
            ...prev,
            [bookingUuid]: photoUrl,
          }))
        }
        onClearPhoto={(bookingUuid) =>
          setPhotosByBookingUuid((prev) => {
            const next = { ...prev };
            delete next[bookingUuid];
            return next;
          })
        }
        onSubmit={handleConfirmTransfer}
        onBack={() => setStep({ kind: "transfer_overview" })}
      />
    );
  } else {
    body = null;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      {header}
      <main className="flex-1">{body}</main>

      {/* Start pickup confirm */}
      <Dialog open={confirmStart} onOpenChange={setConfirmStart}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Start pickup?</DialogTitle>
            <DialogDescription>
              You&apos;re about to claim head-of-picker on this MO. You&apos;ll
              walk to {bookings.length} cell{bookings.length === 1 ? "" : "s"}
              , scan each lot, then transfer the load to a production cell.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmStart(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button onClick={handleStartPickup} disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Start pickup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Abort confirm */}
      <Dialog open={confirmAbort} onOpenChange={setConfirmAbort}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Abort pickup?</DialogTitle>
            <DialogDescription>
              All scanned items will reset. Lots stay on their original
              cells (nothing was physically moved yet). Another picker can
              restart from scratch.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmAbort(false)}
              disabled={pending}
            >
              Keep going
            </Button>
            <Button
              variant="destructive"
              onClick={handleAbort}
              disabled={pending}
            >
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Abort pickup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type PickupLifecycle =
  | "not_released"
  | "released"
  | "in_progress"
  | "handed_off";

interface OverviewBodyProps {
  mo: ManufacturingOrder;
  bookings: ManufacturingOrderBooking[];
  lifecycle: PickupLifecycle;
  allPicked: boolean;
  companyDateFormat: FormatPrefs | null;
  onStartPickup: () => void;
  onAbort: () => void;
  onScanBooking: (bookingUuid: string) => void;
  onConfirmTransfer: () => void;
  pending: boolean;
}

/**
 * "Walk to this cell" card with the same shape used by the put-away
 * flow: floor-plan mini with the target rack highlighted, then a
 * top-down breadcrumb (warehouse → floor → location → cell), then a
 * big "I'm there — scan now" button. Used for both the lot's source
 * cell and the production-feed target cell during transfer.
 */
function DirectionsBody({
  headline,
  cell,
  lotCode,
  qty,
  itemName,
  lastPhotoUrl,
  onContinue,
  onBack,
}: {
  headline: string;
  cell: ManufacturingOrderBookingCellSummary;
  lotCode: string | null;
  qty: string | null;
  itemName: string | null;
  /** Pass `string | null` to render the "Last known photo" tile (with
   *  the empty-state placeholder if null). Omit when the step isn't
   *  about a specific lot — e.g. the "walk the trolley to production"
   *  transfer step. */
  lastPhotoUrl?: string | null;
  onContinue: () => void;
  onBack: () => void;
}) {
  const loc = cell.storage_location;
  const isSystemCell = !!cell.system_kind;
  const rackCode = loc?.code?.trim() || null;
  const rackName = loc?.name?.trim() || null;
  const cellName = cell.name?.trim() || null;
  const shelfLabel =
    cellName ??
    (cell.ordinal !== undefined && cell.ordinal !== null
      ? `Level ${cell.ordinal + 1}`
      : `Cell ${cell.uuid.slice(0, 8)}`);

  const rackPrimary = rackCode ?? rackName ?? "—";
  const rackSuffix = rackCode && rackName ? rackName : null;
  const cellPrimary = cellName ?? shelfLabel;
  const cellSuffix = cellName && cellName !== shelfLabel ? shelfLabel : null;

  return (
    <>
      <main className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {headline}
          </p>
          <p className="text-sm text-muted-foreground">
            {isSystemCell ? (
              <>
                This lot hasn&apos;t been put away to a shelf yet — find
                it in the <span className="font-medium">{cellPrimary}</span>{" "}
                zone. Tap{" "}
                <span className="font-medium">Scan now</span> when you
                have it.
              </>
            ) : (
              <>
                Find the highlighted rack on the floor plan. The label on
                the shelf will read the same code below. Tap{" "}
                <span className="font-medium">Scan now</span> when
                you&apos;re there and point the camera at the QR.
              </>
            )}
          </p>
        </div>

        {(lotCode || itemName || qty) && (
          <div className="rounded-xl border border-border/60 bg-card px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Picking
            </p>
            <p className="text-sm font-medium">
              {itemName ?? "—"}
              {qty ? ` · ${qty} units` : ""}
            </p>
            {lotCode && (
              <p className="font-mono text-[11px] text-muted-foreground">
                {lotCode}
              </p>
            )}
          </div>
        )}

        {isSystemCell ? (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">No shelf assigned</p>
              <p className="text-[12px] opacity-80">
                System cells (receiving / quarantine / hold) aren&apos;t on
                the floor plan. Locate the lot at the receiving zone or
                the cage by name, then continue.
              </p>
            </div>
          </div>
        ) : (
          loc?.floor?.uuid &&
          loc?.uuid && (
            <FloorPlanMini
              floorUuid={loc.floor.uuid}
              targetLocationUuid={loc.uuid}
            />
          )
        )}

        {lastPhotoUrl !== undefined && (
          <LastSeenPhotoCard
            url={lastPhotoUrl}
            caption={itemName ?? "Last seen"}
          />
        )}

        <ol className="space-y-2">
          <DirectionsRow
            icon={Building2}
            label="Warehouse"
            value={loc?.floor?.warehouse?.name ?? "—"}
          />
          <DirectionsRow
            icon={Layers}
            label="Floor"
            value={loc?.floor?.name ?? "—"}
          />
          <DirectionsRow
            icon={MapPin}
            label="Location"
            value={rackPrimary}
            suffix={rackSuffix}
            hero
          />
          <DirectionsRow
            icon={Package}
            label="Cell"
            value={cellPrimary}
            suffix={cellSuffix}
            hero
          />
        </ol>
      </main>

      <footer className="flex gap-2 border-t border-border/60 px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="h-14 px-4"
          onClick={onBack}
        >
          <ChevronLeft className="size-5" />
        </Button>
        <Button
          type="button"
          size="lg"
          className="h-14 flex-1 text-base"
          onClick={onContinue}
        >
          <ScanLine className="mr-2 size-5" />
          I&apos;m there — scan now
        </Button>
      </footer>
    </>
  );
}

function DirectionsRow({
  icon: Icon,
  label,
  value,
  suffix,
  hero,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  suffix?: string | null;
  hero?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-xl border border-border/60 bg-card px-3 py-2",
        hero && "bg-primary/5 border-primary/30",
      )}
    >
      <Icon className={cn("mt-0.5 size-4", hero ? "text-primary" : "text-muted-foreground")} />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "truncate",
            hero ? "text-base font-semibold" : "text-sm",
          )}
        >
          {value}
        </p>
        {suffix && (
          <p className="truncate text-xs text-muted-foreground">{suffix}</p>
        )}
      </div>
    </li>
  );
}

function OverviewBody({
  mo,
  bookings,
  lifecycle,
  allPicked,
  companyDateFormat,
  onStartPickup,
  onAbort,
  onScanBooking,
  onConfirmTransfer,
  pending,
}: OverviewBodyProps) {
  if (lifecycle === "not_released") {
    return (
      <div className="px-4 py-6">
        <NotReleasedNotice />
      </div>
    );
  }
  if (lifecycle === "handed_off") {
    return (
      <div className="px-4 py-6">
        <HandedOffNotice
          mo={mo}
          companyDateFormat={companyDateFormat}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 px-3 py-3">
      <SummaryCard
        mo={mo}
        bookings={bookings}
        lifecycle={lifecycle}
        companyDateFormat={companyDateFormat}
      />

      {lifecycle === "released" && (
        <Button
          type="button"
          className="w-full"
          size="lg"
          onClick={onStartPickup}
          disabled={pending}
        >
          <ScanLine className="mr-2 size-4" />
          Start pickup
        </Button>
      )}

      <ul className="space-y-2">
        {bookings.map((b) => (
          <BookingRow
            key={b.uuid}
            booking={b}
            canScan={lifecycle === "in_progress" && b.picked_at === null}
            onTap={() => onScanBooking(b.uuid)}
          />
        ))}
      </ul>

      {lifecycle === "in_progress" && (
        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onAbort}
            disabled={pending}
            className="text-muted-foreground"
          >
            <X className="mr-1.5 size-3.5" />
            Abort pickup
          </Button>
          <Button
            type="button"
            onClick={onConfirmTransfer}
            disabled={!allPicked || pending}
          >
            Confirm transfer
            <ChevronRight className="ml-1.5 size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  mo,
  bookings,
  lifecycle,
  companyDateFormat,
}: {
  mo: ManufacturingOrder;
  bookings: ManufacturingOrderBooking[];
  lifecycle: PickupLifecycle;
  companyDateFormat: FormatPrefs | null;
}) {
  const pickedCount = bookings.filter((b) => b.picked_at !== null).length;

  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <LifecyclePill lifecycle={lifecycle} />
        {mo.pickup_started_by && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <UserCircle2 className="size-2.5" />
            {mo.pickup_started_by.name}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {pickedCount} of {bookings.length} item{bookings.length === 1 ? "" : "s"} on trolley
      </p>
      {mo.start_at && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          MO starts {formatCompanyDate(mo.start_at, companyDateFormat)}
        </p>
      )}
    </div>
  );
}

function BookingRow({
  booking,
  canScan,
  onTap,
}: {
  booking: ManufacturingOrderBooking;
  canScan: boolean;
  onTap: () => void;
}) {
  const picked = booking.picked_at !== null;
  return (
    <li>
      <button
        type="button"
        onClick={onTap}
        disabled={!canScan}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 text-left transition-colors",
          canScan && "active:bg-muted",
          !canScan && "opacity-80",
          picked && "border-emerald-400/60 bg-emerald-50/40 dark:bg-emerald-950/20",
        )}
      >
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">
              {booking.item?.name ?? "Unknown item"}
            </p>
            {picked && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                <Check className="size-2.5" />
                On trolley
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span>{booking.quantity}</span>
            {booking.stock_lot?.code && (
              <span className="font-mono">{booking.stock_lot.code}</span>
            )}
            {booking.storage_location?.name && (
              <span>Cell {booking.storage_location.name}</span>
            )}
          </div>
        </div>
        {canScan && (
          <ScanLine className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>
    </li>
  );
}

function LifecyclePill({ lifecycle }: { lifecycle: PickupLifecycle }) {
  if (lifecycle === "in_progress") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        <Loader2 className="size-2.5 animate-spin" />
        Picking
      </span>
    );
  }
  if (lifecycle === "released") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-2.5" />
        Ready
      </span>
    );
  }
  if (lifecycle === "handed_off") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
        <PackageCheck className="size-2.5" />
        At production
      </span>
    );
  }
  return null;
}

function NotReleasedNotice() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
      <AlertTriangle className="size-7 text-amber-500/70" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">Not released yet</p>
        <p className="text-xs text-muted-foreground">
          The planner hasn&apos;t released this MO to the warehouse. Wait
          for the release or ask the planner.
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/m/pickup">Back to queue</Link>
      </Button>
    </div>
  );
}

function HandedOffNotice({
  mo,
  companyDateFormat,
}: {
  mo: ManufacturingOrder;
  companyDateFormat: FormatPrefs | null;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-emerald-400/60 bg-emerald-50/40 px-4 py-10 text-center dark:bg-emerald-950/20">
      <PackageCheck className="size-7 text-emerald-600" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">Already at production</p>
        <p className="text-xs text-muted-foreground">
          Transferred on{" "}
          {formatCompanyDate(mo.pickup_completed_at, companyDateFormat)}
          {mo.pickup_completed_by ? ` by ${mo.pickup_completed_by.name}` : ""}
          .
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/m/pickup">Back to queue</Link>
      </Button>
    </div>
  );
}

// ----- Transfer phase (Phase 5) -----

interface TransferOverviewBodyProps {
  bookings: ManufacturingOrderBooking[];
  companyDateFormat: FormatPrefs | null;
  productionCell: ProductionCellChoice | null;
  onPickCell: (cell: ProductionCellChoice) => void;
  onScanCell: () => void;
  onContinue: () => void;
  onBack: () => void;
}

function TransferOverviewBody({
  bookings,
  productionCell,
  onPickCell,
  onScanCell,
  onContinue,
  onBack,
}: TransferOverviewBodyProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fetch a recommended production cell on mount.
  useEffect(() => {
    if (productionCell) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          "/api/m/pickup/production-feed-cells",
          { cache: "no-store" },
        );
        if (!res.ok) {
          setError("Couldn't fetch a production cell — pick one manually.");
          return;
        }
        const data = (await res.json()) as {
          items: Array<{
            uuid: string;
            code: string;
            name: string | null;
            location: ProductionCellChoice["location"];
          }>;
        };
        if (cancelled) return;
        const first = data.items[0];
        if (first) {
          onPickCell({
            uuid: first.uuid,
            code: first.code ?? first.name ?? first.uuid.slice(0, 8),
            name: first.name,
            location: first.location ?? null,
          });
        } else {
          setError(
            "No empty production cell available. Clear one before transferring.",
          );
        }
      } catch {
        setError("Network blip — try again.");
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productionCell, onPickCell]);

  return (
    <div className="space-y-3 px-3 py-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to pickup
      </button>

      <div className="rounded-lg border border-border/60 bg-card px-3 py-3">
        <h2 className="text-sm font-semibold">Ready to transfer</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {bookings.length} lot{bookings.length === 1 ? "" : "s"} on the
          trolley. Confirm where to drop them on the production side.
        </p>
        <ul className="mt-3 space-y-2">
          {bookings.map((b) => (
            <li
              key={b.uuid}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="truncate">{b.item?.name ?? "Item"}</span>
              <span className="font-mono text-muted-foreground">
                {b.stock_lot?.code ?? b.stock_lot?.uuid.slice(0, 8) ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-border/60 bg-card px-3 py-3">
        <h3 className="text-sm font-semibold">Production cell</h3>
        {loading ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Finding an empty production-feed cell…
          </p>
        ) : productionCell ? (
          <p className="mt-2 inline-flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-sm font-medium">
            <Truck className="size-4 text-muted-foreground" />
            {productionCell.code}
          </p>
        ) : (
          <p className="mt-2 text-xs text-destructive">
            {error ?? "No production cell selected."}
          </p>
        )}
        {productionCell && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Walk to {productionCell.code} and tap continue. You&apos;ll scan
            the cell label to confirm, then take a photo per lot as you
            place them.
          </p>
        )}
      </div>

      <Button
        type="button"
        className="w-full"
        size="lg"
        onClick={onScanCell}
        disabled={!productionCell}
      >
        <ScanLine className="mr-2 size-4" />
        Scan production cell
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={onContinue}
        disabled={!productionCell}
      >
        Skip scan — type cell manually
      </Button>
    </div>
  );
}

interface TransferPhotosBodyProps {
  bookings: ManufacturingOrderBooking[];
  photosByBookingUuid: Record<string, string>;
  productionCell: ProductionCellChoice | null;
  pending: boolean;
  onUploadPhoto: (bookingUuid: string, photoUrl: string) => void;
  onClearPhoto: (bookingUuid: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

function TransferPhotosBody({
  bookings,
  photosByBookingUuid,
  productionCell,
  pending,
  onUploadPhoto,
  onClearPhoto,
  onSubmit,
  onBack,
}: TransferPhotosBodyProps) {
  const allDone = bookings.every((b) => photosByBookingUuid[b.uuid]);

  return (
    <div className="space-y-3 px-3 py-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back
      </button>

      {productionCell && (
        <div className="rounded-lg bg-muted px-3 py-2 text-xs">
          Placing lots at{" "}
          <span className="font-semibold">{productionCell.code}</span>
        </div>
      )}

      <ul className="space-y-2">
        {bookings.map((b) => (
          <PhotoRow
            key={b.uuid}
            booking={b}
            photoUrl={photosByBookingUuid[b.uuid] ?? null}
            onUpload={(url) => onUploadPhoto(b.uuid, url)}
            onClear={() => onClearPhoto(b.uuid)}
          />
        ))}
      </ul>

      <Button
        type="button"
        className="w-full"
        size="lg"
        onClick={onSubmit}
        disabled={!allDone || pending}
      >
        {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
        Confirm transfer
      </Button>
    </div>
  );
}

function PhotoRow({
  booking,
  photoUrl,
  onUpload,
  onClear,
}: {
  booking: ManufacturingOrderBooking;
  photoUrl: string | null;
  onUpload: (url: string) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/m/movement-photos", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        toast.error("Photo upload failed.");
        return;
      }
      const { photo_url } = (await res.json()) as { photo_url: string };
      onUpload(photo_url);
    } catch {
      toast.error("Photo upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <li className="rounded-xl border border-border/60 bg-card px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-medium">
            {booking.item?.name ?? "Unknown item"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {booking.stock_lot?.code ?? booking.stock_lot?.uuid?.slice(0, 8) ?? "—"} ·{" "}
            {booking.quantity}
          </p>
        </div>
        {photoUrl ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            <Check className="size-2.5" />
            Photo OK
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Clock className="size-2.5" />
            Pending
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFile}
          className="hidden"
        />
        {photoUrl ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus className="mr-1.5 size-3.5" />
              Retake
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={onClear}
            >
              <X className="mr-1.5 size-3.5" />
              Clear
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Camera className="mr-1.5 size-3.5" />
            )}
            Take photo
          </Button>
        )}
      </div>
    </li>
  );
}

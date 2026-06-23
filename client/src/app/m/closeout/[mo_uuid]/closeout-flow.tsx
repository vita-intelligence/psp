"use client";

/**
 * Mobile post-production closeout flow. Production worker walks
 * each open item (bookings still un-consumed + produced output
 * still at the production-feed cell). For each row:
 *
 *   1. Scan the lot QR (verifies identity; dev bypass available)
 *   2. Enter remaining qty for bookings (default 0 = fully used) —
 *      output lots are always "all of it" (qty already known)
 *   3. Scan the production-side dispatch cell QR (required when
 *      remaining > 0 OR for any output lot)
 *   4. Photo (optional but recommended)
 *   5. Submit → BE stamps consumed + moves remainder to the
 *      scanned cell (or just drops placement on full consumption)
 *
 * The warehouse pickup-from-production step runs separately later.
 */

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Camera,
  ChevronRight,
  ImagePlus,
  Layers,
  Loader2,
  MapPin,
  PackageCheck,
  PackageOpen,
  RefreshCw,
  ScanLine,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import {
  closeoutBookingAction,
  closeoutOutputLotAction,
} from "@/lib/production-closeout/actions";
import type {
  CloseoutOutputLot,
  DispatchCell,
  ManufacturingOrder,
  ManufacturingOrderBooking,
} from "@/lib/production/types";
import { UuidScanStep } from "../../pickup/[mo_uuid]/uuid-scan-step";
import { FloorPlanMini } from "../../lots/[uuid]/move/floor-plan-mini";

type Step =
  | { kind: "overview" }
  | { kind: "scan_lot"; itemKey: string }
  | { kind: "details"; itemKey: string }
  | { kind: "scan_cell"; itemKey: string };

interface Props {
  initialMo: ManufacturingOrder;
  initialBookings: ManufacturingOrderBooking[];
  initialOutputLots: CloseoutOutputLot[];
  dispatchCells: DispatchCell[];
  companyDateFormat: FormatPrefs | null;
}

/** Unified row type so booking + output lot can be walked in the
 *  same UI. `kind` decides the BE endpoint at submit. */
interface CloseoutItem {
  key: string;
  kind: "booking" | "output";
  lotUuid: string;
  lotCode: string | null;
  itemName: string;
  bookedQty: string;
  uomSymbol: string;
  bookingUuid?: string;
}

export function CloseoutFlow({
  initialMo,
  initialBookings,
  initialOutputLots,
  dispatchCells,
  companyDateFormat,
}: Props) {
  const [mo] = useState<ManufacturingOrder>(initialMo);
  const [bookings, setBookings] = useState<ManufacturingOrderBooking[]>(
    initialBookings,
  );
  const [outputLots, setOutputLots] =
    useState<CloseoutOutputLot[]>(initialOutputLots);
  const [step, setStep] = useState<Step>({ kind: "overview" });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  // Per-row in-flight values.
  const [remainingQty, setRemainingQty] = useState("0");
  const [scannedCell, setScannedCell] = useState<DispatchCell | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  const items: CloseoutItem[] = useMemo(() => {
    const bookingItems: CloseoutItem[] = bookings.map((b) => ({
      key: `b:${b.uuid}`,
      kind: "booking",
      lotUuid: b.stock_lot?.uuid ?? "",
      lotCode: b.stock_lot?.code ?? null,
      itemName: b.item?.name ?? "Unknown item",
      bookedQty: b.quantity,
      uomSymbol: b.item?.stock_uom?.symbol ?? "ea",
      bookingUuid: b.uuid,
    }));
    const outputItems: CloseoutItem[] = outputLots.map((l) => ({
      key: `o:${l.uuid}`,
      kind: "output",
      lotUuid: l.uuid,
      lotCode: l.code,
      itemName: l.item?.name ?? "Manufactured output",
      bookedQty: l.qty_on_hand,
      uomSymbol: l.uom?.symbol ?? "ea",
    }));
    return [...bookingItems, ...outputItems];
  }, [bookings, outputLots]);

  const activeItem =
    step.kind === "overview"
      ? null
      : items.find((i) => i.key === step.itemKey) ?? null;

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/m/closeout/${mo.uuid}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        bookings: ManufacturingOrderBooking[];
        output_lots: CloseoutOutputLot[];
      };
      setBookings(body.bookings);
      setOutputLots(body.output_lots);
    } catch {
      // silent — header refresh button will re-trigger
    } finally {
      setIsRefreshing(false);
    }
  }, [mo.uuid]);

  function startItem(item: CloseoutItem) {
    setRemainingQty(item.kind === "output" ? item.bookedQty : "0");
    setScannedCell(null);
    setPhotoUrl(null);
    setErrorDetail(null);
    setStep({ kind: "scan_lot", itemKey: item.key });
  }

  function backToOverview() {
    setStep({ kind: "overview" });
    setRemainingQty("0");
    setScannedCell(null);
    setPhotoUrl(null);
    setErrorDetail(null);
  }

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErrorDetail(null);
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/m/movement-photos", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        photo_url?: string;
        detail?: string;
      };
      if (!res.ok || !data.photo_url) {
        setErrorDetail(data.detail ?? "Photo upload failed.");
        return;
      }
      setPhotoUrl(data.photo_url);
    } finally {
      setPhotoUploading(false);
      e.target.value = "";
    }
  }

  function submit() {
    if (!activeItem) return;
    const remaining = Number(remainingQty);
    if (Number.isNaN(remaining) || remaining < 0) {
      setErrorDetail("Remaining qty must be a non-negative number.");
      return;
    }
    if (
      activeItem.kind === "booking" &&
      remaining > Number(activeItem.bookedQty)
    ) {
      setErrorDetail(
        `Remaining can't exceed the booked qty (${activeItem.bookedQty} ${activeItem.uomSymbol}).`,
      );
      return;
    }
    if ((activeItem.kind === "output" || remaining > 0) && !scannedCell) {
      setErrorDetail(
        "Scan a production-dispatch cell before submitting.",
      );
      return;
    }

    setErrorDetail(null);
    startTransition(async () => {
      if (activeItem.kind === "booking") {
        const res = await closeoutBookingAction(
          mo.uuid,
          activeItem.bookingUuid!,
          {
            remaining_qty: remainingQty,
            scanned_cell_uuid: scannedCell?.uuid ?? null,
            photo_url: photoUrl,
          },
        );
        if (res.ok) {
          toast.success(
            remaining > 0
              ? "Consumed + remainder handed off"
              : "Fully consumed",
          );
          setBookings((prev) => prev.filter((b) => b.uuid !== res.booking.uuid));
          backToOverview();
        } else {
          setErrorDetail(res.detail);
        }
      } else {
        const res = await closeoutOutputLotAction(mo.uuid, activeItem.lotUuid, {
          scanned_cell_uuid: scannedCell!.uuid,
          photo_url: photoUrl,
        });
        if (res.ok) {
          toast.success("Output handed off to dispatch");
          setOutputLots((prev) =>
            prev.filter((l) => l.uuid !== activeItem.lotUuid),
          );
          backToOverview();
        } else {
          setErrorDetail(res.detail);
        }
      }
    });
  }

  const allDone = items.length === 0;

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
            <Link href="/m/closeout" aria-label="Back to closeout queue">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <p className="truncate font-mono text-[11px] uppercase text-muted-foreground">
              {mo.code ?? `MO #${mo.id}`}
            </p>
            <h1 className="truncate text-sm font-semibold tracking-tight">
              {mo.item?.name ?? "Closeout"}
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

      {step.kind === "overview" && (
        <main className="flex-1 space-y-3 px-3 py-3">
          {errorDetail && <ErrorBanner detail={errorDetail} />}

          {allDone ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-10 text-center text-emerald-900 dark:text-emerald-200">
              <CheckCircle2 className="size-7" />
              <div className="space-y-1">
                <p className="text-sm font-semibold">Closeout complete</p>
                <p className="text-xs opacity-80">
                  Every booking is consumed, every output lot has been
                  handed off. Warehouse will pick up from dispatch next.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/m/closeout">Back to queue</Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                <p className="font-medium">
                  {items.length} item{items.length === 1 ? "" : "s"} to
                  close out
                </p>
                <p className="opacity-80">
                  Each row gets scanned at the production-feed cell;
                  remainder + output land at a dispatch cell.
                </p>
              </div>
              <ul className="space-y-2">
                {items.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => startItem(item)}
                      className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 text-left active:bg-muted"
                    >
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              item.kind === "output"
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                : "bg-sky-500/15 text-sky-700 dark:text-sky-300",
                            )}
                          >
                            {item.kind === "output" ? "Output" : "Material"}
                          </span>
                          {item.lotCode && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {item.lotCode}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-sm font-medium">
                          {item.itemName}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {item.kind === "output"
                            ? `${item.bookedQty} ${item.uomSymbol} produced, awaiting hand-off`
                            : `${item.bookedQty} ${item.uomSymbol} booked — confirm what's left`}
                        </p>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </main>
      )}

      {step.kind === "scan_lot" && activeItem && activeItem.lotUuid && (
        <main className="flex-1 px-4 py-4">
          <div className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <p className="text-[10px] uppercase tracking-wider">
              Step 1 of 3 — scan the lot
            </p>
            <p className="mt-0.5 text-sm font-medium text-foreground">
              {activeItem.itemName}{" "}
              <span className="text-muted-foreground">
                · {activeItem.bookedQty} {activeItem.uomSymbol}
              </span>
            </p>
          </div>
          <UuidScanStep
            expectedUuid={activeItem.lotUuid}
            kind="lot"
            expectedLabel={
              activeItem.lotCode ?? `Lot ${activeItem.lotUuid.slice(0, 8)}`
            }
            onConfirmed={() =>
              setStep({ kind: "details", itemKey: activeItem.key })
            }
            onCancel={backToOverview}
          />
        </main>
      )}

      {step.kind === "details" && activeItem && (
        <main className="flex-1 space-y-3 px-4 py-4">
          <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <p className="text-[10px] uppercase tracking-wider">
              Step 2 of 3 — record details
            </p>
            <p className="mt-0.5 text-sm font-medium text-foreground">
              {activeItem.itemName}{" "}
              <span className="text-muted-foreground">
                · {activeItem.bookedQty} {activeItem.uomSymbol}
              </span>
            </p>
          </div>

          {activeItem.kind === "booking" ? (
            <div className="space-y-1.5">
              <Label htmlFor="remaining-qty" className="text-xs">
                Remaining (not consumed) qty ({activeItem.uomSymbol})
              </Label>
              <Input
                id="remaining-qty"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={remainingQty}
                onChange={(e) =>
                  setRemainingQty(e.target.value.replace(",", "."))
                }
                className="h-11 font-mono text-base"
              />
              <p className="text-[11px] text-muted-foreground">
                Booked: {activeItem.bookedQty} {activeItem.uomSymbol}.
                Type 0 if you used it all. Any leftover gets moved to
                the dispatch cell you scan next.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">
              <p className="font-medium">
                {activeItem.bookedQty} {activeItem.uomSymbol} of produced
                output
              </p>
              <p className="opacity-80">
                The full output lot will be handed off — scan a
                dispatch cell next.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Photo (recommended)</Label>
            {photoUrl ? (
              <div className="flex items-center justify-between rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-[12px] text-emerald-900 dark:text-emerald-200">
                <span>Photo uploaded ✓</span>
                <button
                  type="button"
                  onClick={() => setPhotoUrl(null)}
                  className="text-[11px] underline"
                >
                  Replace
                </button>
              </div>
            ) : (
              <label className="flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border/60 bg-muted/30 text-sm text-muted-foreground hover:bg-muted">
                {photoUploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-4" />
                )}
                {photoUploading ? "Uploading…" : "Take / pick a photo"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={onPhotoChange}
                  className="hidden"
                  disabled={photoUploading}
                />
              </label>
            )}
          </div>

          {errorDetail && <ErrorBanner detail={errorDetail} />}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={backToOverview}
              className="flex-1"
            >
              <X className="mr-1.5 size-4" />
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                const remaining = Number(remainingQty);
                if (
                  activeItem.kind === "output" ||
                  (!Number.isNaN(remaining) && remaining > 0)
                ) {
                  setStep({ kind: "scan_cell", itemKey: activeItem.key });
                } else {
                  // Fully consumed booking — no cell scan needed.
                  submit();
                }
              }}
              className="flex-1"
              disabled={pending || photoUploading}
            >
              {pending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {activeItem.kind === "output" ||
              Number(remainingQty) > 0 ? (
                <>
                  <ScanLine className="mr-1.5 size-4" />
                  Scan dispatch cell
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-1.5 size-4" />
                  Mark fully consumed
                </>
              )}
            </Button>
          </div>
        </main>
      )}

      {step.kind === "scan_cell" && activeItem && (
        <main className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <p className="text-[10px] uppercase tracking-wider">
              Step 3 of 3 — drop at dispatch cell
            </p>
            <p className="mt-0.5 text-sm font-medium text-foreground">
              {scannedCell
                ? "Walk to the highlighted cell below, then confirm"
                : "Pick a production-side dispatch cell to hand off to"}
            </p>
          </div>

          {scannedCell ? (
            <DispatchDirections
              cell={scannedCell}
              onReselect={() => setScannedCell(null)}
              onConfirm={submit}
              pending={pending}
              errorDetail={errorDetail}
            />
          ) : (
            <CellPicker
              cells={dispatchCells}
              onPick={(cell) => setScannedCell(cell)}
              onCancel={() =>
                setStep({ kind: "details", itemKey: activeItem.key })
              }
            />
          )}
        </main>
      )}
    </div>
  );
}

function CellPicker({
  cells,
  onPick,
  onCancel,
}: {
  cells: DispatchCell[];
  onPick: (cell: DispatchCell) => void;
  onCancel: () => void;
}) {
  if (cells.length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-3 text-xs text-rose-900 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <p>
            No dispatch cells configured on this production site. Ask
            an admin to tag at least one storage cell with purpose=
            <code>dispatch</code> via /settings/warehouses.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          className="w-full"
        >
          <X className="mr-1.5 size-4" />
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        Scan the dispatch cell QR or tap one below.
      </p>
      <ul className="space-y-1">
        {cells.map((cell) => (
          <li key={cell.uuid}>
            <button
              type="button"
              onClick={() => onPick(cell)}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-border/60 bg-card px-3 py-2 text-left active:bg-muted"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{cell.code}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {cell.location?.floor?.name ?? "—"} · {cell.name ?? "—"}
                </p>
              </div>
              <Camera className="size-4 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="ghost"
        onClick={onCancel}
        className="w-full"
      >
        <X className="mr-1.5 size-4" />
        Back
      </Button>
    </div>
  );
}

function DispatchDirections({
  cell,
  onReselect,
  onConfirm,
  pending,
  errorDetail,
}: {
  cell: DispatchCell;
  onReselect: () => void;
  onConfirm: () => void;
  pending: boolean;
  errorDetail: string | null;
}) {
  const rackCode = cell.location?.code?.trim() || null;
  const rackName = cell.location?.name?.trim() || null;
  const cellCode = cell.code?.trim() || null;
  const shelfLabel =
    cell.name?.trim() ||
    (cell.ordinal !== null && cell.ordinal !== undefined
      ? `Level ${cell.ordinal + 1}`
      : `Cell ${cell.id}`);

  return (
    <div className="space-y-3">
      {cell.location?.floor?.uuid && cell.location?.uuid && (
        <FloorPlanMini
          floorUuid={cell.location.floor.uuid}
          targetLocationUuid={cell.location.uuid}
        />
      )}

      <ul className="space-y-2">
        <DirectionsRow
          icon={Building2}
          label="Warehouse"
          value={cell.location?.floor?.warehouse?.name ?? "—"}
        />
        <DirectionsRow
          icon={Layers}
          label="Floor"
          value={cell.location?.floor?.name ?? "—"}
        />
        <DirectionsRow
          icon={MapPin}
          label="Rack"
          value={rackName ?? rackCode ?? "—"}
          suffix={rackCode && rackName ? rackCode : null}
        />
        <DirectionsRow
          icon={Sparkles}
          label="Shelf"
          value={cellCode ?? shelfLabel}
          suffix={cellCode ? shelfLabel : null}
          hero
        />
      </ul>

      {errorDetail && <ErrorBanner detail={errorDetail} />}

      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          className="flex-1"
          onClick={onReselect}
          disabled={pending}
        >
          Re-pick
        </Button>
        <Button
          type="button"
          className="flex-1"
          onClick={onConfirm}
          disabled={pending}
        >
          {pending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
          <CheckCircle2 className="mr-1.5 size-4" />
          Confirm hand-off
        </Button>
      </div>
    </div>
  );
}

function DirectionsRow({
  icon: Icon,
  label,
  value,
  suffix,
  hero,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  suffix?: string | null;
  hero?: boolean;
}) {
  return (
    <li
      className={
        hero
          ? "flex items-center gap-3 rounded-lg border-2 border-brand/40 bg-brand/[0.06] px-3 py-3"
          : "flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2"
      }
    >
      <span
        className={
          hero
            ? "grid size-9 shrink-0 place-items-center rounded-full bg-brand/15 text-brand"
            : "grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
        }
      >
        <Icon className={hero ? "size-4" : "size-3.5"} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p
          className={
            hero ? "truncate text-base font-semibold" : "truncate text-sm"
          }
        >
          {value}
          {suffix && (
            <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
              {suffix}
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

// Silence the unused-import warning for icons defined for future use.
void formatCompanyDate;
void PackageCheck;
void PackageOpen;

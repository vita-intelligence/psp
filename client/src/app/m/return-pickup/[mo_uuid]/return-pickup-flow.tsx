"use client";

/**
 * Warehouse return-pickup flow. Phase C — mirror of /m/pickup but
 * reversed: lots sit at a production-side dispatch cell, get scanned
 * onto the worker's trolley, then placed back into warehouse storage.
 *
 *   PICK  (at the dispatch cell)
 *     1. Scan dispatch cell QR
 *     2. Scan lot QR
 *     3. Photo (optional but recommended)
 *     4. POST /lots/:uuid/pick → trolley row inserted
 *
 *   PLACE (at the warehouse rack)
 *     1. Recommendation cards — system suggests where to put it,
 *        ranked by tags + consolidation + dimensional fit (same
 *        engine the PO put-away flow uses).
 *     2. Operator taps a card OR scans a freeform cell to override.
 *     3. Scan that target cell QR to confirm physical presence.
 *     4. Scan the lot QR (defense-in-depth — wrong lot = wrong rack).
 *     5. Photo (recommended).
 *     6. POST /picks/:uuid/place → Stock.move_placement runs.
 *
 * Trolley state lives in BE rows so it survives reloads.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Camera,
  CheckCircle2,
  ChevronRight,
  ImagePlus,
  Layers,
  Loader2,
  MapPin,
  PackagePlus,
  Pencil,
  RefreshCw,
  ScanLine,
  Sparkles,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import { cn } from "@/lib/utils";
import type { FormatPrefs } from "@/lib/format/company";
import {
  abortReturnPickAction,
  pickReturnLotAction,
  placeReturnLotAction,
} from "@/lib/warehouse-return-pickup/actions";
import type {
  ManufacturingOrder,
  ReturnPickRow,
  ReturnPickupLot,
} from "@/lib/production/types";
import type { MoveRecommendation } from "@/lib/stock/mobile";
import { UuidScanStep } from "../../pickup/[mo_uuid]/uuid-scan-step";
import { FloorPlanMini } from "../../lots/[uuid]/move/floor-plan-mini";

type Mode = "mo" | "loose";

type PlaceTarget = {
  uuid: string;
  cell: MoveRecommendation["cell"];
  reason?: string;
};

type Step =
  | { kind: "overview" }
  | {
      kind: "pick_scan_cell";
      lotKey: string;
    }
  | { kind: "pick_scan_lot"; lotKey: string }
  | { kind: "pick_photo"; lotKey: string }
  | { kind: "place_recommend"; pickKey: string }
  | { kind: "place_freeform_scan"; pickKey: string }
  | { kind: "place_directions"; pickKey: string; target: PlaceTarget }
  | { kind: "place_scan_cell"; pickKey: string; target: PlaceTarget }
  | { kind: "place_scan_lot"; pickKey: string; target: PlaceTarget }
  | { kind: "place_photo"; pickKey: string; target: PlaceTarget };

interface Props {
  mode: Mode;
  initialMo: ManufacturingOrder | null;
  initialLots: ReturnPickupLot[];
  initialTrolley: ReturnPickRow[];
  initialOthers: ReturnPickRow[];
  companyDateFormat: FormatPrefs | null;
}

export function ReturnPickupFlow({
  mode,
  initialMo,
  initialLots,
  initialTrolley,
  initialOthers,
}: Props) {
  const [mo] = useState(initialMo);
  const [lots, setLots] = useState<ReturnPickupLot[]>(initialLots);
  const [trolley, setTrolley] = useState<ReturnPickRow[]>(initialTrolley);
  const [others, setOthers] = useState<ReturnPickRow[]>(initialOthers);
  const [step, setStep] = useState<Step>({ kind: "overview" });
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pending, startTransition] = useTransition();

  const lotByKey = useMemo(
    () =>
      Object.fromEntries(
        lots.map((l) => [l.uuid, l] as const),
      ) as Record<string, ReturnPickupLot>,
    [lots],
  );
  const pickByKey = useMemo(
    () =>
      Object.fromEntries(
        trolley.map((t) => [t.uuid, t] as const),
      ) as Record<string, ReturnPickRow>,
    [trolley],
  );

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const url =
        mode === "mo" && mo
          ? `/api/m/return-pickup/${encodeURIComponent(mo.uuid)}`
          : "/api/m/return-pickup/loose";
      const [primary, trolleyRes] = await Promise.all([
        fetch(url, { cache: "no-store" }),
        fetch("/api/m/return-pickup/trolley", { cache: "no-store" }),
      ]);
      if (primary.ok) {
        const body = (await primary.json()) as
          | {
              lots_at_dispatch: ReturnPickupLot[];
              trolley: ReturnPickRow[];
              trolley_others?: ReturnPickRow[];
            }
          | { items: ReturnPickupLot[] };
        if ("lots_at_dispatch" in body) {
          setLots(body.lots_at_dispatch);
          setTrolley(body.trolley);
          setOthers(body.trolley_others ?? []);
        } else {
          setLots(body.items);
        }
      }
      if (trolleyRes.ok && mode === "loose") {
        const body = (await trolleyRes.json()) as {
          items: ReturnPickRow[];
          others?: ReturnPickRow[];
        };
        setTrolley(body.items);
        setOthers(body.others ?? []);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [mode, mo]);

  function resetPhoto() {
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

  function startPick(lot: ReturnPickupLot) {
    resetPhoto();
    setStep({ kind: "pick_scan_cell", lotKey: lot.uuid });
  }

  function startPlace(pick: ReturnPickRow) {
    resetPhoto();
    setStep({ kind: "place_recommend", pickKey: pick.uuid });
  }

  function chooseTarget(pickKey: string, target: PlaceTarget) {
    resetPhoto();
    setStep({ kind: "place_directions", pickKey, target });
  }

  function backToOverview() {
    setStep({ kind: "overview" });
    resetPhoto();
  }

  function submitPick(lotUuid: string, scannedCellUuid: string) {
    startTransition(async () => {
      const res = await pickReturnLotAction(lotUuid, {
        scanned_cell_uuid: scannedCellUuid,
        photo_url: photoUrl,
      });
      if (res.ok) {
        toast.success("On your trolley");
        setTrolley((prev) => [...prev, res.pick]);
        setLots((prev) => prev.filter((l) => l.uuid !== lotUuid));
        backToOverview();
      } else {
        setErrorDetail(res.detail);
      }
    });
  }

  function submitPlace(
    pickUuid: string,
    scannedCellUuid: string,
    skipPhotoReason: string | null,
  ) {
    startTransition(async () => {
      const res = await placeReturnLotAction(pickUuid, {
        scanned_cell_uuid: scannedCellUuid,
        photo_url: photoUrl,
        skip_photo_reason: skipPhotoReason,
      });
      if (res.ok) {
        toast.success("Placed back into storage");
        setTrolley((prev) => prev.filter((t) => t.uuid !== pickUuid));
        backToOverview();
      } else {
        setErrorDetail(res.detail);
      }
    });
  }

  function abortPick(pick: ReturnPickRow) {
    startTransition(async () => {
      const res = await abortReturnPickAction(pick.uuid);
      if (res.ok) {
        toast.success("Trolley row removed");
        setTrolley((prev) => prev.filter((t) => t.uuid !== pick.uuid));
        if (pick.stock_lot) void refresh();
      } else {
        setErrorDetail(res.detail);
      }
    });
  }

  const title = mode === "mo" && mo ? mo.code ?? `MO #${mo.id}` : "Loose dispatch";
  const subtitle =
    mode === "mo" && mo
      ? mo.item?.name ?? "Return pickup"
      : "Lots without an MO source";

  const allDone = lots.length === 0 && trolley.length === 0;

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
            <Link href="/m/return-pickup" aria-label="Back to return-pickup queue">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <p className="truncate font-mono text-[11px] uppercase text-muted-foreground">
              {title}
            </p>
            <h1 className="truncate text-sm font-semibold tracking-tight">
              {subtitle}
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
        <main className="flex-1 space-y-4 px-3 py-3">
          {errorDetail && <ErrorBanner detail={errorDetail} />}

          {allDone ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-10 text-center text-emerald-900 dark:text-emerald-200">
              <CheckCircle2 className="size-7" />
              <div className="space-y-1">
                <p className="text-sm font-semibold">Everything is back in storage</p>
                <p className="text-xs opacity-80">
                  Dispatch cells are empty, your trolley is empty.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/m/return-pickup">Back to queue</Link>
              </Button>
            </div>
          ) : (
            <>
              {trolley.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      On your trolley · {trolley.length}
                    </h2>
                    <Truck className="size-3 text-muted-foreground" />
                  </div>
                  <ul className="space-y-2">
                    {trolley.map((pick) => (
                      <TrolleyRow
                        key={pick.uuid}
                        pick={pick}
                        onPlace={() => startPlace(pick)}
                        onAbort={() => abortPick(pick)}
                        busy={pending}
                      />
                    ))}
                  </ul>
                </section>
              )}

              {lots.length > 0 && (
                <section className="space-y-2">
                  <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Waiting at dispatch · {lots.length}
                  </h2>
                  <ul className="space-y-2">
                    {lots.map((lot) => (
                      <DispatchRow
                        key={lot.uuid}
                        lot={lot}
                        onPick={() => startPick(lot)}
                      />
                    ))}
                  </ul>
                </section>
              )}

              {others.length > 0 && (
                <section className="space-y-2">
                  <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Held by colleagues · {others.length}
                  </h2>
                  <p className="px-1 text-[11px] text-muted-foreground">
                    Read-only. These lots are already on someone else's
                    trolley — they'll vanish from your dispatch list
                    until placed back.
                  </p>
                  <ul className="space-y-2">
                    {others.map((pick) => (
                      <PeerTrolleyRow key={pick.uuid} pick={pick} />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </main>
      )}

      {step.kind === "pick_scan_cell" && lotByKey[step.lotKey] && (
        <PickScanCellStep
          lot={lotByKey[step.lotKey]}
          onConfirmed={() =>
            setStep({ kind: "pick_scan_lot", lotKey: step.lotKey })
          }
          onCancel={backToOverview}
        />
      )}

      {step.kind === "pick_scan_lot" && lotByKey[step.lotKey] && (
        <PickScanLotStep
          lot={lotByKey[step.lotKey]}
          onConfirmed={() =>
            setStep({ kind: "pick_photo", lotKey: step.lotKey })
          }
          onCancel={backToOverview}
        />
      )}

      {step.kind === "pick_photo" && lotByKey[step.lotKey] && (
        <PhotoStep
          title="Photo of lot on trolley"
          hint="Show the lot label + trolley — recommended, not strictly required."
          photoUrl={photoUrl}
          uploading={photoUploading}
          pending={pending}
          errorDetail={errorDetail}
          onPhotoChange={onPhotoChange}
          onClearPhoto={() => setPhotoUrl(null)}
          onCancel={backToOverview}
          onConfirm={() => {
            const lot = lotByKey[step.lotKey];
            if (!lot?.dispatch_cell) {
              setErrorDetail("Lot lost its dispatch cell — refresh and retry.");
              return;
            }
            submitPick(lot.uuid, lot.dispatch_cell.uuid);
          }}
          confirmIcon={<Truck className="mr-1.5 size-4" />}
          confirmLabel="Load onto trolley"
        />
      )}

      {step.kind === "place_recommend" && pickByKey[step.pickKey] && (
        <PlaceRecommendStep
          pick={pickByKey[step.pickKey]}
          onChoose={(target) => chooseTarget(step.pickKey, target)}
          onScanInstead={() =>
            setStep({ kind: "place_freeform_scan", pickKey: step.pickKey })
          }
          onCancel={backToOverview}
        />
      )}

      {step.kind === "place_freeform_scan" && pickByKey[step.pickKey] && (
        <PlaceFreeformScanStep
          pick={pickByKey[step.pickKey]}
          onChosen={(target) => chooseTarget(step.pickKey, target)}
          onBackToRecommendations={() =>
            setStep({ kind: "place_recommend", pickKey: step.pickKey })
          }
        />
      )}

      {step.kind === "place_directions" && pickByKey[step.pickKey] && (
        <PlaceDirectionsStep
          target={step.target}
          pick={pickByKey[step.pickKey]}
          onContinue={() =>
            setStep({
              kind: "place_scan_cell",
              pickKey: step.pickKey,
              target: step.target,
            })
          }
          onChooseDifferent={() =>
            setStep({ kind: "place_recommend", pickKey: step.pickKey })
          }
        />
      )}

      {step.kind === "place_scan_cell" && pickByKey[step.pickKey] && (
        <main className="flex-1 px-4 py-4">
          <div className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <p className="text-[10px] uppercase tracking-wider">
              Step 3 of 4 — scan target rack
            </p>
            <p className="mt-0.5 text-sm font-medium text-foreground">
              {formatLocation(step.target.cell.storage_location)} ·{" "}
              {step.target.cell.name}
            </p>
          </div>
          <UuidScanStep
            expectedUuid={step.target.uuid}
            kind="cell"
            expectedLabel={
              step.target.cell.code ??
              step.target.cell.name ??
              `Cell ${step.target.cell.id}`
            }
            onConfirmed={() =>
              setStep({
                kind: "place_scan_lot",
                pickKey: step.pickKey,
                target: step.target,
              })
            }
            onCancel={() =>
              setStep({
                kind: "place_directions",
                pickKey: step.pickKey,
                target: step.target,
              })
            }
          />
        </main>
      )}

      {step.kind === "place_scan_lot" && pickByKey[step.pickKey] && (
        <main className="flex-1 px-4 py-4">
          <div className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <p className="text-[10px] uppercase tracking-wider">
              Step 4 of 4 — scan the lot
            </p>
            <p className="mt-0.5 text-sm font-medium text-foreground">
              {pickByKey[step.pickKey].stock_lot?.item?.name ?? "Unknown item"}
            </p>
          </div>
          <UuidScanStep
            expectedUuid={pickByKey[step.pickKey].stock_lot?.uuid ?? ""}
            kind="lot"
            expectedLabel={
              pickByKey[step.pickKey].stock_lot?.code ?? "this lot"
            }
            onConfirmed={() =>
              setStep({
                kind: "place_photo",
                pickKey: step.pickKey,
                target: step.target,
              })
            }
            onCancel={() =>
              setStep({
                kind: "place_scan_cell",
                pickKey: step.pickKey,
                target: step.target,
              })
            }
          />
        </main>
      )}

      {step.kind === "place_photo" && pickByKey[step.pickKey] && (
        <PlaceConfirmStep
          pick={pickByKey[step.pickKey]}
          target={step.target}
          photoUrl={photoUrl}
          uploading={photoUploading}
          pending={pending}
          errorDetail={errorDetail}
          onPhotoChange={onPhotoChange}
          onClearPhoto={() => setPhotoUrl(null)}
          onSubmit={(skipReason) =>
            submitPlace(step.pickKey, step.target.uuid, skipReason)
          }
        />
      )}
    </div>
  );
}

function DispatchRow({
  lot,
  onPick,
}: {
  lot: ReturnPickupLot;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 text-left active:bg-muted"
      >
        <LastSeenPhoto
          url={lot.last_photo_url}
          size="sm"
          caption={lot.item?.name ?? "Last seen"}
        />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              {lot.dispatch_cell?.code ?? "Dispatch"}
            </span>
            {lot.code && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {lot.code}
              </span>
            )}
          </div>
          <p className="truncate text-sm font-medium">
            {lot.item?.name ?? "Unknown item"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {lot.qty_on_hand} {lot.uom?.symbol ?? ""}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

function PeerTrolleyRow({ pick }: { pick: ReturnPickRow }) {
  const initials =
    (pick.picked_by?.name ?? pick.picked_by?.email ?? "?")
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  const pickedAt = pick.picked_at ? new Date(pick.picked_at) : null;
  const ago = pickedAt ? minutesAgo(pickedAt) : null;

  return (
    <li className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground/10 text-[11px] font-semibold">
        {initials}
      </span>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {pick.picked_by?.name ?? pick.picked_by?.email ?? "Colleague"}
          </span>
          {pick.stock_lot?.code && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {pick.stock_lot.code}
            </span>
          )}
        </div>
        <p className="truncate text-sm font-medium">
          {pick.stock_lot?.item?.name ?? "Unknown item"}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {pick.qty} {pick.stock_lot?.uom?.symbol ?? ""} · from{" "}
          {pick.picked_from_cell?.name ?? "dispatch"}
          {ago !== null && ` · ${ago === 0 ? "just now" : `${ago}m ago`}`}
        </p>
      </div>
    </li>
  );
}

function minutesAgo(at: Date): number {
  const ms = Date.now() - at.getTime();
  return Math.max(0, Math.floor(ms / 60_000));
}

function TrolleyRow({
  pick,
  onPlace,
  onAbort,
  busy,
}: {
  pick: ReturnPickRow;
  onPlace: () => void;
  onAbort: () => void;
  busy: boolean;
}) {
  return (
    <li className="flex items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/5 px-3 py-2.5">
      <LastSeenPhoto
        url={pick.stock_lot?.last_photo_url}
        size="sm"
        caption={pick.stock_lot?.item?.name ?? "Last seen"}
      />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200">
            On trolley
          </span>
          {pick.stock_lot?.code && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {pick.stock_lot.code}
            </span>
          )}
        </div>
        <p className="truncate text-sm font-medium">
          {pick.stock_lot?.item?.name ?? "Unknown item"}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {pick.qty} {pick.stock_lot?.uom?.symbol ?? ""} · from{" "}
          {pick.picked_from_cell?.name ?? "dispatch"}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onAbort}
        disabled={busy}
        aria-label="Remove from trolley"
        className="size-9 p-0"
      >
        <Trash2 className="size-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={onPlace}
        disabled={busy}
        className="h-9"
      >
        <PackagePlus className="mr-1.5 size-4" />
        Place
      </Button>
    </li>
  );
}

function PickScanCellStep({
  lot,
  onConfirmed,
  onCancel,
}: {
  lot: ReturnPickupLot;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  if (!lot.dispatch_cell) {
    return (
      <main className="flex-1 px-4 py-4">
        <div className="rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-3 text-xs text-rose-900 dark:text-rose-200">
          <p className="font-medium">No dispatch cell recorded.</p>
          <p className="opacity-80">
            Refresh and try again — the lot may have been moved.
          </p>
        </div>
        <Button variant="ghost" className="mt-3 w-full" onClick={onCancel}>
          Back
        </Button>
      </main>
    );
  }

  const cell = lot.dispatch_cell;
  const rackCode = cell.location?.code?.trim() || null;
  const rackName = cell.location?.name?.trim() || null;
  const cellCode = cell.code?.trim() || null;
  const shelfLabel =
    cell.name?.trim() ||
    (cell.ordinal !== null && cell.ordinal !== undefined
      ? `Level ${cell.ordinal + 1}`
      : `Cell ${cell.id}`);

  return (
    <main className="flex-1 px-4 py-4 space-y-3 overflow-y-auto">
      <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        <p className="text-[10px] uppercase tracking-wider">
          Step 1 of 3 — walk to dispatch + scan
        </p>
        <p className="mt-0.5 text-sm font-medium text-foreground">
          {lot.item?.name ?? "Unknown item"}{" "}
          <span className="text-muted-foreground">
            · {lot.qty_on_hand} {lot.uom?.symbol ?? ""}
          </span>
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          The highlighted cell is where the lot is waiting. Walk to
          it, then scan the QR.
        </p>
      </div>

      {cell.location?.floor?.uuid && cell.location?.uuid && (
        <FloorPlanMini
          floorUuid={cell.location.floor.uuid}
          targetLocationUuid={cell.location.uuid}
        />
      )}

      <div className="rounded-lg border border-border/60 bg-card p-3">
        <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          Last known photo of this lot
        </p>
        <LastSeenPhoto
          url={lot.last_photo_url}
          size="lg"
          caption={lot.item?.name ?? "Last seen"}
        />
        {!lot.last_photo_url && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            No photo on file yet — this lot has never been photographed
            on a movement.
          </p>
        )}
      </div>

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

      <UuidScanStep
        expectedUuid={lot.dispatch_cell.uuid}
        kind="cell"
        expectedLabel={lot.dispatch_cell.code}
        onConfirmed={onConfirmed}
        onCancel={onCancel}
      />
    </main>
  );
}

function PlaceRecommendStep({
  pick,
  onChoose,
  onScanInstead,
  onCancel,
}: {
  pick: ReturnPickRow;
  onChoose: (target: PlaceTarget) => void;
  onScanInstead: () => void;
  onCancel: () => void;
}) {
  const [recs, setRecs] = useState<MoveRecommendation[] | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/m/return-pickup/picks/${encodeURIComponent(pick.uuid)}/recommendations`,
          { cache: "no-store" },
        );
        const body = (await res.json()) as {
          items?: MoveRecommendation[];
          detail?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setErrorDetail(body.detail ?? "Couldn't load suggestions.");
          setRecs([]);
        } else {
          setRecs(body.items ?? []);
        }
      } catch (err) {
        if (cancelled) return;
        setErrorDetail(
          err instanceof Error ? err.message : "Network blip — try again.",
        );
        setRecs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pick.uuid]);

  return (
    <>
      <main className="flex-1 px-4 py-4 space-y-3">
        <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <p className="text-[10px] uppercase tracking-wider">
            Step 1 of 4 — pick a rack
          </p>
          <p className="mt-0.5 text-sm font-medium text-foreground">
            {pick.stock_lot?.item?.name ?? "Unknown item"}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Ranked by storage tags, consolidation with existing stock,
            and dimensional fit.
          </p>
        </div>

        {errorDetail && <ErrorBanner detail={errorDetail} />}

        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : recs && recs.length > 0 ? (
          <ul className="space-y-2">
            {recs.map((rec) => (
              <li key={rec.cell.uuid}>
                <button
                  type="button"
                  onClick={() =>
                    onChoose({
                      uuid: rec.cell.uuid,
                      cell: rec.cell,
                      reason: rec.reason,
                    })
                  }
                  className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-3 text-left active:bg-muted"
                >
                  <Sparkles className="size-4 shrink-0 text-amber-500" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate font-mono text-[11px] font-semibold">
                      {rec.cell.storage_location?.code ?? "—"} ·{" "}
                      {rec.cell.code ?? `CELL #${rec.cell.id}`}
                    </p>
                    <p className="truncate text-sm">
                      {formatLocation(rec.cell.storage_location)} ·{" "}
                      {rec.cell.name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {rec.cell.warehouse?.name ?? "—"} ·{" "}
                      {rec.cell.floor?.name ?? "—"}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                        {rec.reason}
                      </span>
                      {rec.fit && <FitBadge fit={rec.fit} />}
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
            <Sparkles className="mx-auto size-6 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium">No suggestions</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The item has no storage tags set, or no cells match its
              tags. Scan or pick a rack manually.
            </p>
          </div>
        )}
      </main>

      <footer className="space-y-2 border-t border-border/60 px-4 py-3">
        <Button
          variant="outline"
          size="lg"
          className="h-12 w-full"
          onClick={onScanInstead}
        >
          <ScanLine className="mr-2 size-4" />
          Scan a different rack
        </Button>
        <Button
          variant="ghost"
          className="h-10 w-full text-muted-foreground"
          onClick={onCancel}
        >
          <X className="mr-1.5 size-4" />
          Cancel
        </Button>
      </footer>
    </>
  );
}

function PlaceDirectionsStep({
  target,
  pick,
  onContinue,
  onChooseDifferent,
}: {
  target: PlaceTarget;
  pick: ReturnPickRow;
  onContinue: () => void;
  onChooseDifferent: () => void;
}) {
  const cell = target.cell;
  const rackCode = cell.storage_location?.code?.trim() || null;
  const rackName = cell.storage_location?.name?.trim() || null;
  const cellCode = cell.code?.trim() || null;
  const shelfLabel =
    cell.name?.trim() ||
    (cell.ordinal !== undefined && cell.ordinal !== null
      ? `Level ${cell.ordinal + 1}`
      : `Cell ${cell.id}`);

  return (
    <main className="flex-1 px-4 py-4 space-y-3 overflow-y-auto">
      <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        <p className="text-[10px] uppercase tracking-wider">
          Step 2 of 4 — walk to this rack
        </p>
        {target.reason && (
          <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
            {target.reason}
          </p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          The highlighted rack on the floor plan is where the lot
          goes. Walk to it, then scan the shelf QR.
        </p>
      </div>

      {cell.floor?.uuid && cell.storage_location?.uuid && (
        <FloorPlanMini
          floorUuid={cell.floor.uuid}
          targetLocationUuid={cell.storage_location.uuid}
        />
      )}

      <div className="rounded-lg border border-border/60 bg-card p-3">
        <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          Last known photo of this lot
        </p>
        <LastSeenPhoto
          url={pick.stock_lot?.last_photo_url}
          size="lg"
          caption={pick.stock_lot?.item?.name ?? "Last seen"}
        />
      </div>

      <ul className="space-y-2">
        <DirectionsRow
          icon={Building2}
          label="Warehouse"
          value={cell.warehouse?.name ?? "—"}
        />
        <DirectionsRow
          icon={Layers}
          label="Floor"
          value={cell.floor?.name ?? "—"}
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

      <div className="flex flex-col gap-2 pt-1">
        <Button size="lg" className="h-12" onClick={onContinue}>
          <ScanLine className="mr-1.5 size-4" />
          I'm there — scan the rack
        </Button>
        <Button
          variant="ghost"
          onClick={onChooseDifferent}
          className="text-muted-foreground"
        >
          <Pencil className="mr-1.5 size-4" />
          Pick a different rack
        </Button>
      </div>
    </main>
  );
}

function PlaceFreeformScanStep({
  pick,
  onChosen,
  onBackToRecommendations,
}: {
  pick: ReturnPickRow;
  onChosen: (target: PlaceTarget) => void;
  onBackToRecommendations: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const scannedRef = useRef<string | null>(null);

  return (
    <main className="flex-1 px-4 py-4 space-y-3">
      <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        <p className="text-[10px] uppercase tracking-wider">
          Manual scan
        </p>
        <p className="mt-0.5 text-sm font-medium text-foreground">
          Override the suggestions and scan any warehouse rack QR.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-900 dark:text-rose-200">
          {error}
        </div>
      )}

      <UuidScanStep
        expectedUuid="*"
        kind="cell"
        expectedLabel="any warehouse rack"
        onScanned={(uuid) => {
          if (pick.picked_from_cell && uuid === pick.picked_from_cell.uuid) {
            setError(
              "That's the dispatch cell — pick a warehouse rack instead.",
            );
            scannedRef.current = null;
            return;
          }
          setError(null);
          scannedRef.current = uuid;
        }}
        onConfirmed={() => {
          if (scannedRef.current) {
            // Without recommendation context we only have the uuid,
            // not a breadcrumb — pass a minimal cell shell so the
            // directions step still renders something sensible.
            onChosen({
              uuid: scannedRef.current,
              cell: {
                id: 0,
                uuid: scannedRef.current,
                name: "Manually scanned",
                code: null,
                ordinal: null,
                tags: [],
                storage_location: null,
                floor: null,
                warehouse: null,
              } as unknown as MoveRecommendation["cell"],
              reason: "Manually scanned",
            });
          }
        }}
        onCancel={onBackToRecommendations}
      />
    </main>
  );
}

function FitBadge({
  fit,
}: {
  fit: {
    free_pct: number;
    percent_used: number;
    current_percent_used?: number;
    projected_percent_used?: number;
  };
}) {
  const tone =
    fit.free_pct >= 50
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : fit.free_pct >= 20
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-red-500/15 text-red-700 dark:text-red-400";

  const headline =
    fit.free_pct >= 50
      ? `${fit.free_pct}% free`
      : fit.free_pct >= 20
        ? `Tight — ${fit.free_pct}% free`
        : `Almost full — ${fit.free_pct}% free`;

  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}
    >
      {headline}
    </span>
  );
}

function formatLocation(
  loc: { name?: string | null; code?: string | null } | null | undefined,
): string {
  if (!loc) return "—";
  const name = loc.name?.trim();
  const code = loc.code?.trim();
  if (name && code) return `${name} · ${code}`;
  return name || code || "—";
}

/**
 * Last-known photo of a lot. Rendered next to the floor-plan on
 * pickup screens so the worker can spot the actual box / pallet on
 * the shelf, not just match a label. Falls back to a placeholder
 * tile if the lot has never been photographed.
 */
function LastSeenPhoto({
  url,
  size = "md",
  caption,
}: {
  url: string | null | undefined;
  size?: "sm" | "md" | "lg";
  caption?: string;
}) {
  const dim =
    size === "sm" ? "size-12" : size === "lg" ? "h-44 w-full" : "size-20";

  if (!url) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/40 text-muted-foreground",
          dim,
        )}
        title="No photo on record for this lot yet"
      >
        <Camera className="size-4 opacity-60" />
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted",
        dim,
      )}
      title={caption ?? "Tap to enlarge"}
    >
      <Image
        src={url}
        alt={caption ?? "Last known photo of this lot"}
        fill
        sizes="(max-width: 600px) 50vw, 200px"
        className="object-cover"
        unoptimized
      />
    </a>
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

function PickScanLotStep({
  lot,
  onConfirmed,
  onCancel,
}: {
  lot: { uuid: string; code: string | null; item: { name?: string | null } | null; qty_on_hand: string; uom: { symbol: string } | null };
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  return (
    <main className="flex-1 px-4 py-4">
      <div className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        <p className="text-[10px] uppercase tracking-wider">
          Step 2 of 3 — scan the lot
        </p>
        <p className="mt-0.5 text-sm font-medium text-foreground">
          {lot.item?.name ?? "Unknown item"}{" "}
          <span className="text-muted-foreground">
            · {lot.qty_on_hand} {lot.uom?.symbol ?? ""}
          </span>
        </p>
      </div>
      <UuidScanStep
        expectedUuid={lot.uuid}
        kind="lot"
        expectedLabel={lot.code ?? `Lot ${lot.uuid.slice(0, 8)}`}
        onConfirmed={onConfirmed}
        onCancel={onCancel}
      />
    </main>
  );
}

const SKIP_PHOTO_REASONS = [
  { value: "blurry_capture", label: "Couldn't get a clear photo" },
  { value: "camera_unavailable", label: "Camera not working" },
  { value: "tight_quarters", label: "Couldn't reach the angle" },
  { value: "other", label: "Other" },
];

function PlaceConfirmStep({
  pick,
  target,
  photoUrl,
  uploading,
  pending,
  errorDetail,
  onPhotoChange,
  onClearPhoto,
  onSubmit,
}: {
  pick: ReturnPickRow;
  target: PlaceTarget;
  photoUrl: string | null;
  uploading: boolean;
  pending: boolean;
  errorDetail: string | null;
  onPhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearPhoto: () => void;
  onSubmit: (skipReason: string | null) => void;
}) {
  const [skipReason, setSkipReason] = useState("");
  const cell = target.cell;

  function handleSubmit() {
    onSubmit(photoUrl ? null : skipReason || null);
  }

  return (
    <>
      <main className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-3.5" />
            <span>Scan confirmed</span>
          </div>
          <p className="mt-1 text-sm font-semibold">
            {cell.warehouse?.name ?? "—"} ·{" "}
            {formatLocation(cell.storage_location)} · {cell.name ?? "—"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {cell.floor?.name ?? "—"}
          </p>
        </section>

        <section className="space-y-2 rounded-lg border border-border/60 bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Quantity
          </p>
          <p className="font-mono text-lg font-semibold">
            {pick.qty}{" "}
            <span className="text-sm font-medium text-muted-foreground">
              {pick.stock_lot?.uom?.symbol ?? ""}
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            Locked at pickup — the full trolley row goes onto this rack.
          </p>
        </section>

        <section className="space-y-2 rounded-lg border border-border/60 bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Photo
          </p>
          {photoUrl ? (
            <div className="flex items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
              <CheckCircle2 className="size-4 text-emerald-600" />
              <span className="flex-1 text-sm">Photo attached</span>
              <button
                type="button"
                onClick={onClearPhoto}
                className="text-xs text-muted-foreground underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <>
              <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md border border-border/60 bg-muted/50 text-sm font-medium">
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-4" />
                )}
                {uploading ? "Uploading…" : "Take photo"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={onPhotoChange}
                  className="hidden"
                  disabled={uploading}
                />
              </label>
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">
                  Or skip with a reason:
                </p>
                <Select value={skipReason} onValueChange={setSkipReason}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Pick a reason…" />
                  </SelectTrigger>
                  <SelectContent>
                    {SKIP_PHOTO_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </section>

        {errorDetail && <ErrorBanner detail={errorDetail} />}
      </main>

      <footer className="space-y-2 border-t border-border/60 bg-background px-4 py-3">
        {!photoUrl && !skipReason && (
          <p className="text-center text-[11px] text-muted-foreground">
            Add a photo or pick a skip reason to continue.
          </p>
        )}
        <Button
          size="lg"
          className="h-14 w-full text-base"
          onClick={handleSubmit}
          disabled={pending || uploading || (!photoUrl && !skipReason)}
        >
          {pending ? (
            <Loader2 className="mr-2 size-5 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 size-5" />
          )}
          Confirm placement
        </Button>
      </footer>
    </>
  );
}

function PhotoStep({
  title,
  hint,
  photoUrl,
  uploading,
  pending,
  errorDetail,
  onPhotoChange,
  onClearPhoto,
  onCancel,
  onConfirm,
  confirmIcon,
  confirmLabel,
}: {
  title: string;
  hint: string;
  photoUrl: string | null;
  uploading: boolean;
  pending: boolean;
  errorDetail: string | null;
  onPhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearPhoto: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  confirmIcon: React.ReactNode;
  confirmLabel: string;
}) {
  return (
    <main className="flex-1 px-4 py-4 space-y-3">
      <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        <p className="text-[10px] uppercase tracking-wider">Step 3 of 3</p>
        <p className="mt-0.5 text-sm font-medium text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>

      {photoUrl ? (
        <div className="flex items-center justify-between rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-[12px] text-emerald-900 dark:text-emerald-200">
          <span>Photo uploaded ✓</span>
          <button
            type="button"
            onClick={onClearPhoto}
            className="text-[11px] underline"
          >
            Replace
          </button>
        </div>
      ) : (
        <label className="flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border/60 bg-muted/30 text-sm text-muted-foreground hover:bg-muted">
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImagePlus className="size-4" />
          )}
          {uploading ? "Uploading…" : "Take / pick a photo"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPhotoChange}
            className="hidden"
            disabled={uploading}
          />
        </label>
      )}

      {errorDetail && <ErrorBanner detail={errorDetail} />}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          className="flex-1"
          onClick={onCancel}
          disabled={pending}
        >
          <X className="mr-1.5 size-4" />
          Cancel
        </Button>
        <Button
          type="button"
          className="flex-1"
          onClick={onConfirm}
          disabled={pending || uploading}
        >
          {pending ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            confirmIcon
          )}
          {confirmLabel}
        </Button>
      </div>
    </main>
  );
}

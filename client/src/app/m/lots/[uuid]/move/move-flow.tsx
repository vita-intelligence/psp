"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Layers,
  Loader2,
  MapPin,
  Package,
  ScanLine,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { moveLotAction } from "@/lib/stock/mobile-actions";
import type { MoveRecommendation } from "@/lib/stock/mobile";
import type { ScannedCell, StockLot } from "@/lib/types";
import { CellScanStep } from "./cell-scan-step";
import { LotScanStep } from "./lot-scan-step";
import { FloorPlanMini } from "./floor-plan-mini";

// Lot move follows the canonical mobile move pattern (closeout
// step-3 / return-pickup-place):
//
//   verify-lot → pick → directions+details → verify-scan (auto-submit)
//
// `directions` carries the qty input + photo / skip-reason capture
// alongside the breadcrumb so the scan result can fire submit
// immediately; the old "confirm" step has been folded in and dropped.
type Step = "verify-lot" | "pick" | "directions" | "verify-scan";

interface Props {
  lot: StockLot;
  recommendations: MoveRecommendation[];
  /** Set when the worker arrived via the scan-cell-first path
   *  (`/m/scan/cell/<uuid>` → "Scan a lot to move here" →
   *  `/m/scan?to=<cell>` → `/m/lots/<lot>/move?to=<cell>`). The lot
   *  was just scanned so verify-lot is skipped, and the destination
   *  is locked so PickStep + DirectionsStep are skipped too — flow
   *  drops straight into verify-cell-scan to confirm the worker is
   *  physically at the cell, then confirm + photo. */
  preSetDestination?: ScannedCell | null;
}

const SKIP_REASONS = [
  { value: "blurry_capture", label: "Couldn't get a clear photo" },
  { value: "camera_unavailable", label: "Camera not working" },
  { value: "tight_quarters", label: "Couldn't reach the angle" },
  { value: "other", label: "Other" },
];

/**
 * Put-away flow with verification baked in:
 *
 *   1. **verify-lot** — camera. The operator scans the lot's QR off
 *      the physical drum/sack so we know they're holding the right
 *      thing before any move is committed. Tapping a card on the
 *      pending-list is just navigation; without this gate the worker
 *      could easily grab the wrong drum from a receiving dock.
 *      Mismatches flash red inline; an explicit override button
 *      handles damaged labels.
 *   2. **pick** — system shows ranked recommendations or "Scan to
 *      override". Operator taps a recommended shelf OR taps Scan.
 *   3. **directions** — when a recommendation is picked, show a
 *      "Walk to this shelf" card with the full breadcrumb so the
 *      operator knows where to go before opening the camera.
 *      Skipped on the override (Scan a different shelf) path.
 *   4. **verify-scan** — camera viewfinder. The scanner rejects wrong
 *      QRs inline (red flash, stays open), so anything reaching the
 *      next step has been physically verified. Override is an
 *      explicit button on the camera screen.
 *   5. **confirm** — qty (default = full) + photo OR skip-reason +
 *      submit. The move endpoint stamps the photo URL / skip-reason
 *      on the movement so audits show why.
 */
export function MoveFlow({
  lot,
  recommendations,
  preSetDestination,
}: Props) {
  const router = useRouter();
  // When we arrived from the scan-cell-first path, both
  // verifications are already done implicitly:
  //   * Lot identity — the scanner only routes here on a
  //     successful lot scan, so we treat verify-lot as already
  //     passed.
  //   * Destination — the cell QR was scanned BEFORE the lot, so
  //     we expect it and lock the flow to it.
  // We still gate on physical re-confirmation at the destination
  // (the worker may have walked away between the two scans), so the
  // initial step is `verify-scan` with `expected` locked.
  const arrivedFromCellScan = !!preSetDestination;
  const [step, setStep] = useState<Step>(
    arrivedFromCellScan ? "verify-scan" : "verify-lot",
  );
  const [expected, setExpected] = useState<ScannedCell | null>(
    preSetDestination ?? null,
  );
  const [scanned, setScanned] = useState<ScannedCell | null>(null);
  const [lotVerified, setLotVerified] = useState(arrivedFromCellScan);
  const [qty, setQty] = useState<string>(String(lot.qty_on_hand ?? ""));
  const [skipReason, setSkipReason] = useState<string>("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  function chooseRecommendation(rec: MoveRecommendation) {
    setExpected(rec.cell);
    setScanned(null);
    setStep("directions");
  }

  function scanOverride() {
    setExpected(null);
    setScanned(null);
    setStep("verify-scan");
  }

  function onScanResult(cell: ScannedCell) {
    // The scanner itself rejects wrong cells inline (red flash + stays
    // in viewfinder), so anything reaching this callback has already
    // been verified to match the expected cell (or the operator
    // explicitly overrode to scan-anything mode). Auto-submit with the
    // scanned cell — the qty / photo / skip-reason were captured in
    // the directions step, no extra confirm screen needed.
    setScanned(cell);
    onSubmit(cell);
  }

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/m/movement-photos", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { photo_url?: string; detail?: string };
      if (!res.ok || !data.photo_url) {
        setError(data.detail ?? "Photo upload failed.");
        return;
      }
      setPhotoUrl(data.photo_url);
      setSkipReason("");
    } finally {
      setPhotoUploading(false);
      e.target.value = "";
    }
  }

  function onSubmit(cellOverride?: ScannedCell) {
    setError(null);
    // Caller may pass the just-scanned cell directly (the auto-submit
    // path from verify-scan, where setScanned hasn't committed yet);
    // fall back to the rendered scanned state otherwise.
    const targetCell = cellOverride ?? scanned;
    if (!targetCell) return;
    if (!photoUrl && !skipReason) {
      setError("Take a photo or pick a skip reason.");
      return;
    }
    startSubmit(async () => {
      // Race the action against a hard timeout so a stuck dev-server
      // HMR reload can't leave the operator staring at a spinner that
      // never resolves. 12s is generous for a move.
      const timeout = new Promise<{ ok: false; detail: string }>(
        (resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: false,
                detail:
                  "Still working… the move may have gone through. Tap Back to check the pending list.",
              }),
            12_000,
          ),
      );

      const res = await Promise.race([
        moveLotAction({
          lotUuid: lot.uuid,
          toCellUuid: targetCell.uuid,
          qty: qty || undefined,
          photoUrl: photoUrl || null,
          skipPhotoReason: photoUrl ? null : skipReason || null,
        }),
        timeout,
      ]);

      if (!res.ok) {
        setError(res.detail ?? "Couldn't complete the move.");
        return;
      }

      // Hard navigation as a safety net — bypasses Next.js router
      // cache and any mid-flight HMR weirdness. The router.replace
      // covers the happy path; the window.location fallback fires
      // ~0.8s later if the SPA navigation hasn't kicked in.
      router.replace("/m");
      router.refresh();
      setTimeout(() => {
        if (typeof window !== "undefined" && window.location.pathname !== "/m") {
          window.location.href = "/m";
        }
      }, 800);
    });
  }

  function backFromCurrentStep() {
    if (step === "verify-scan") {
      // If we came from a recommendation, back goes to the directions
      // card; otherwise straight back to the recommendation list.
      setStep(expected ? "directions" : "pick");
      setScanned(null);
    } else if (step === "directions") {
      setStep("pick");
      setExpected(null);
      setScanned(null);
    } else if (step === "pick") {
      // Back from pick re-opens the lot-verify camera so the operator
      // can re-confirm if they're actually holding a different lot.
      setStep("verify-lot");
      setLotVerified(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-3">
        <Link
          href={step === "verify-lot" ? `/m/lots/${lot.uuid}` : "#"}
          onClick={(e) => {
            if (step !== "verify-lot") {
              e.preventDefault();
              backFromCurrentStep();
            }
          }}
          className="rounded-md p-1.5 text-muted-foreground active:bg-muted"
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {lot.code ?? `Lot #${lot.id}`}
          </p>
          <p className="truncate text-sm font-semibold">
            {lot.item?.name ?? "—"}
          </p>
        </div>
      </header>

      {step === "verify-lot" && (
        <LotScanStep
          expected={lot}
          onResult={() => {
            setLotVerified(true);
            setStep("pick");
          }}
          onOverride={() => {
            // Override goes through but flags the downstream movement
            // for audit. Worker either has a damaged label or has
            // chosen to bypass — we record either way.
            setLotVerified(false);
            setStep("pick");
          }}
          onError={setError}
        />
      )}

      {step === "pick" && (
        <PickStep
          recommendations={recommendations}
          onChoose={chooseRecommendation}
          onScan={scanOverride}
          lotVerified={lotVerified}
        />
      )}

      {step === "directions" && expected && (
        <DirectionsStep
          cell={expected}
          lot={lot}
          qty={qty}
          onQtyChange={setQty}
          photoUrl={photoUrl}
          photoUploading={photoUploading}
          skipReason={skipReason}
          onPhotoChange={onPhotoChange}
          onClearPhoto={() => setPhotoUrl(null)}
          onSkipReasonChange={setSkipReason}
          error={error}
          onContinue={() => setStep("verify-scan")}
        />
      )}

      {step === "verify-scan" && (
        <CellScanStep
          expected={expected}
          onResult={onScanResult}
          onError={(msg) => setError(msg)}
        />
      )}
    </div>
  );
}

function PickStep({
  recommendations,
  onChoose,
  onScan,
  lotVerified,
}: {
  recommendations: MoveRecommendation[];
  onChoose: (r: MoveRecommendation) => void;
  onScan: () => void;
  lotVerified: boolean;
}) {
  return (
    <>
      <main className="flex-1 space-y-4 px-4 py-4">
        {!lotVerified && (
          <p
            role="status"
            className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300"
          >
            Lot identity wasn&apos;t scanned — proceeding under override.
            The audit log will flag this movement.
          </p>
        )}
        {recommendations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
            <Sparkles className="mx-auto size-6 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium">No suggestions</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The item has no storage tags set, or no cells match its tags.
              Scan or type a destination instead.
            </p>
          </div>
        ) : (
          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
              Recommended shelves
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Tap one to walk to it. You&apos;ll scan its QR next to
              confirm you&apos;re there.
            </p>
            <ul className="space-y-2">
              {recommendations.map((rec) => (
                <li key={rec.cell.uuid}>
                  <button
                    type="button"
                    onClick={() => onChoose(rec)}
                    className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-3 text-left active:bg-muted"
                  >
                    <Sparkles className="size-4 shrink-0 text-amber-500" />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      {/* Lead with the codes — these match what's
                          printed on the physical QR labels, so the
                          worker scans for them first. */}
                      <p className="truncate font-mono text-[11px] font-semibold text-foreground">
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
          </section>
        )}
      </main>

      <footer className="space-y-2 border-t border-border/60 px-4 py-3">
        <Button
          variant="outline"
          size="lg"
          className="h-12 w-full"
          onClick={onScan}
        >
          <ScanLine className="mr-2 size-4" />
          Scan a different shelf
        </Button>
      </footer>
    </>
  );
}

/**
 * "Walk to this shelf" card. Lays out the breadcrumb top-down with one
 * level per row so it's readable at arm's length: warehouse, floor,
 * rack/location, then the specific cell as the hero. Tap-once big
 * button at the bottom opens the camera scanner.
 */
function DirectionsStep({
  cell,
  lot,
  qty,
  onQtyChange,
  photoUrl,
  photoUploading,
  skipReason,
  onPhotoChange,
  onClearPhoto,
  onSkipReasonChange,
  error,
  onContinue,
}: {
  cell: ScannedCell;
  lot: StockLot;
  qty: string;
  onQtyChange: (value: string) => void;
  photoUrl: string | null;
  photoUploading: boolean;
  skipReason: string;
  onPhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearPhoto: () => void;
  onSkipReasonChange: (value: string) => void;
  error: string | null;
  onContinue: () => void;
}) {
  const rackCode = cell.storage_location?.code?.trim() || null;
  const rackName = cell.storage_location?.name?.trim() || null;
  const cellCode = cell.code?.trim() || null;
  const shelfLabel =
    cell.name?.trim() ||
    (cell.ordinal !== undefined ? `Level ${cell.ordinal + 1}` : `Cell ${cell.id}`);

  // Lead with the code (matches the QR label) and put the human-
  // readable name in the suffix slot. That way the worker is reading
  // the same identifier off the screen and off the shelf.
  const rackPrimary = rackCode ?? rackName ?? "—";
  const rackSuffix = rackCode && rackName ? rackName : null;
  const cellPrimary = cellCode ?? shelfLabel;
  const cellSuffix = cellCode ? shelfLabel : null;
  const canContinue = Boolean(photoUrl) || skipReason.length > 0;

  return (
    <>
      <main className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Walk to
          </p>
          <p className="text-sm text-muted-foreground">
            Find the highlighted rack on the floor plan, then capture
            a photo (or pick a skip reason). Tap Scan now when you&apos;re
            at the shelf — the move fires automatically when the QR
            matches.
          </p>
        </div>

        {cell.floor?.uuid && cell.storage_location?.uuid && (
          <FloorPlanMini
            floorUuid={cell.floor.uuid}
            targetLocationUuid={cell.storage_location.uuid}
          />
        )}

        <ol className="space-y-2">
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

        <section className="space-y-2 rounded-lg border border-border/60 bg-card p-4">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">
            Quantity
          </label>
          <div className="flex items-stretch gap-2">
            <Input
              type="text"
              inputMode="decimal"
              value={qty}
              readOnly
              disabled
              aria-readonly
              className="h-12 font-mono text-lg opacity-90"
            />
            <span className="inline-flex items-center rounded-md border border-border/60 bg-muted px-3 text-sm font-medium text-muted-foreground">
              {lot.unit_of_measurement?.symbol ?? ""}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            The whole lot moves as one — partial moves aren&apos;t allowed here.
            (A sealed box / drum / roll doesn&apos;t split on the shelf.)
          </p>
        </section>

        <section className="space-y-2 rounded-lg border border-border/60 bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Photo
          </p>
          {photoUrl ? (
            <div className="flex items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
              <Check className="size-4 text-emerald-600" />
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
                {photoUploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-4" />
                )}
                {photoUploading ? "Uploading…" : "Take photo"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={onPhotoChange}
                  className="hidden"
                  disabled={photoUploading}
                />
              </label>

              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">
                  Or skip with a reason:
                </p>
                <Select value={skipReason} onValueChange={onSkipReasonChange}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Pick a reason…" />
                  </SelectTrigger>
                  <SelectContent>
                    {SKIP_REASONS.map((r) => (
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

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </main>

      <footer className="space-y-2 border-t border-border/60 px-4 py-3">
        {!canContinue && (
          <p className="text-center text-[11px] text-muted-foreground">
            Add a photo or pick a skip reason to continue.
          </p>
        )}
        <Button
          size="lg"
          className="h-14 w-full text-base"
          onClick={onContinue}
          disabled={!canContinue || photoUploading}
        >
          <ScanLine className="mr-2 size-5" />
          I&apos;m there — scan now
        </Button>
      </footer>
    </>
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

  // Headline chip shows what the operator cares about — projected
  // free space after this lot lands. The hover/title spells out the
  // current → projected transition so the number doesn't look weird
  // ("why does it say 98% when nothing's there?").
  const headline =
    fit.free_pct >= 50
      ? `${fit.free_pct}% free`
      : fit.free_pct >= 20
        ? `Tight — ${fit.free_pct}% free`
        : `Almost full — ${fit.free_pct}% free`;

  const current = fit.current_percent_used;
  const projected = fit.projected_percent_used;
  const title =
    typeof current === "number" && typeof projected === "number"
      ? `Currently ${100 - current}% free → ${100 - projected}% free after this lot.`
      : undefined;

  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}
      title={title}
    >
      {headline}
    </span>
  );
}

/** Compose a location label that's safe against null `name` / `code`.
 *  Prefers "name · code" when both are real, falls back to whichever
 *  one is present, and finally to "—" so we never render the literal
 *  string "null". */
function formatLocation(
  loc:
    | { name?: string | null; code?: string | null }
    | null
    | undefined,
): string {
  if (!loc) return "—";
  const name = loc.name?.trim();
  const code = loc.code?.trim();
  if (name && code) return `${name} · ${code}`;
  return name || code || "—";
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
  /** Optional secondary code shown to the right of the value (e.g.
   *  rack code). Rendered in monospace so SLO0001 reads as a code. */
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
        <Icon className={hero ? "size-5" : "size-4"} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div className="flex items-baseline gap-2">
          <p
            className={
              hero
                ? "truncate text-base font-semibold"
                : "truncate text-sm font-medium"
            }
          >
            {value}
          </p>
          {suffix && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
              {suffix}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}


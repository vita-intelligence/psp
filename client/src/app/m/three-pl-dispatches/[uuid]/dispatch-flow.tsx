"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, MapPin, Package, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";
import { completeDispatchAction } from "@/lib/three-pl/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type { PendingDispatch } from "@/lib/three-pl/types";
import { UuidScanStep } from "../../pickup/[mo_uuid]/uuid-scan-step";
import { FloorPlanMini } from "../../lots/[uuid]/move/floor-plan-mini";

type Step =
  | "scan_source_cell"
  | "scan_lot"
  | "confirm_pick"
  | "pick_dest_cell"
  | "walk_to_dest"
  | "scan_dest_cell";

/**
 * Mobile 3PL dispatch pick + walk flow. The picker phone's job is
 * to physically move a bailee lot from its three_pl_storage cell to
 * a dispatch cell — that's it. Truck evidence (vehicle registration,
 * driver name, checklist, seal, temperature, loading photos)
 * belongs on the standard Shipment's pickup-event form and is
 * captured on the desktop later, on a different day. Steps:
 *
 *   1. Scan source three_pl_storage cell (must match the pending
 *      dispatch's source cell).
 *   2. Scan lot QR (must match the dispatch's lot).
 *   3. Confirm pick — big qty number, "I've got them".
 *   4. Pick a destination dispatch cell — tap a suggestion
 *      (dispatch cells in the source warehouse) or fall through to
 *      the freeform scan branch.
 *   5. Walk to it — FloorPlanMini renders the rack, "I'm at the
 *      cell" advances into the scan step.
 *   6. Scan the destination dispatch cell. On confirm the flow
 *      POSTs /complete which, in one transaction:
 *        * fires the Stock.Movement into the dispatch cell,
 *        * flips the Dispatch row to `completed`,
 *        * spawns a draft Shipment against the lot.
 *      From there the standard shipment paperwork (mark ready →
 *      pickup event with all truck evidence → delivery confirm)
 *      takes over on the desktop — same code path a direct-ship CO
 *      travels.
 */
export function DispatchFlow({ dispatch }: { dispatch: PendingDispatch }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("scan_source_cell");
  const [destCellUuid, setDestCellUuid] = useState<string | null>(null);
  const [pickedDestCell, setPickedDestCell] = useState<
    PendingDispatch["suggested_dest_cells"][number] | null
  >(null);
  const [error, setError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const lot = dispatch.lot;
  const unit = lot?.unit_symbol ?? "";
  const sourceCell = dispatch.source_cell;
  const sourceCellLabel = cellLabel(sourceCell);
  const sourceLocLabel = locationLabel(dispatch.source_location);
  const suggestions = dispatch.suggested_dest_cells ?? [];

  const submitMove = useCallback(
    (toCellUuid: string) => {
      setError(null);
      startTransition(async () => {
        const res = await completeDispatchAction(dispatch.uuid, {
          to_cell_uuid: toCellUuid,
        });
        if (!res.ok) {
          setError(res);
          return;
        }
        toast.success("Moved to the shipping bay. Shipment paperwork queued.");
        router.push("/m/three-pl-dispatches");
      });
    },
    [dispatch.uuid, router],
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-3">
        <Link
          href="/m/three-pl-dispatches"
          className="rounded-md p-1.5 text-muted-foreground active:bg-muted"
          aria-label="Back to queue"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-wider text-muted-foreground">
            3PL dispatch
          </p>
          <p className="truncate text-sm font-semibold">
            {dispatch.qty}
            {unit ? ` ${unit}` : ""} of {lot?.item?.name ?? "—"}
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-3 px-3 py-4">
        {/* Context strip — visible on every step so the picker
             remembers what they're picking. */}
        <section className="rounded-lg border border-border/60 bg-card p-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <ContextRow
              icon={<Package className="size-3.5" />}
              label="Lot"
              value={lot?.code ?? "—"}
              mono
            />
            <ContextRow
              icon={<Truck className="size-3.5" />}
              label="Customer"
              value={lot?.bailee_customer?.name ?? "—"}
            />
            <ContextRow
              icon={<MapPin className="size-3.5" />}
              label="Source"
              value={`${sourceLocLabel} · ${sourceCellLabel}`}
            />
            <ContextRow
              icon={<Package className="size-3.5" />}
              label="Batch"
              value={lot?.supplier_batch_no ?? "—"}
              mono
            />
          </div>
          {dispatch.reference && (
            <p className="mt-2 rounded-md bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
              Ref: {dispatch.reference}
            </p>
          )}
          {dispatch.notes && (
            <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-900 dark:text-amber-100">
              Note from desk: {dispatch.notes}
            </p>
          )}
        </section>

        {/* Progress dots. When the warehouse has no dispatch cells
             pre-loaded (no suggestions), the picker never visits the
             ``pick_dest_cell`` step — hide it so the row stops showing
             a mystery "Ship" pill nobody can reach. */}
        <div className="flex items-center justify-between gap-1 text-[10px]">
          {STEPS.filter((s) => {
            // Suggestion-only steps drop out when the warehouse has
            // no dispatch cells preloaded (freeform-scan fallback).
            if (s.key === "pick_dest_cell") return suggestions.length > 0;
            if (s.key === "walk_to_dest")
              return suggestions.length > 0 && !!pickedDestCell;
            return true;
          }).map((s, i, visibleSteps) => {
            const stepIdx = visibleSteps.findIndex((x) => x.key === step);
            const done = i < stepIdx;
            const active = s.key === step;
            return (
              <div
                key={s.key}
                className={`flex-1 rounded-full py-1 text-center ${
                  done
                    ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                    : active
                      ? "bg-brand/20 text-brand"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {s.short}
              </div>
            );
          })}
        </div>

        {step === "scan_source_cell" && sourceCell && (
          <UuidScanStep
            expectedUuid={sourceCell.uuid}
            kind="cell"
            expectedLabel={`${sourceLocLabel} · ${sourceCellLabel}`}
            onConfirmed={() => setStep("scan_lot")}
            onCancel={() => router.back()}
          />
        )}

        {step === "scan_lot" && lot && (
          <UuidScanStep
            expectedUuid={lot.uuid}
            kind="lot"
            expectedLabel={`${lot.code ?? "lot"} · ${lot.item?.name ?? ""}`}
            onConfirmed={() => setStep("confirm_pick")}
            onCancel={() => setStep("scan_source_cell")}
          />
        )}

        {step === "confirm_pick" && (
          <section className="space-y-3 rounded-lg border border-border/60 bg-card p-4 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand/10">
              <Package className="size-7 text-brand" />
            </div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Take from this cell
            </p>
            <p className="font-mono text-4xl font-semibold">
              {dispatch.qty}
              {unit ? ` ${unit}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Load them on the trolley and walk to the shipping bay.
            </p>
            <Button
              className="w-full"
              size="lg"
              onClick={() =>
                setStep(
                  suggestions.length > 0 ? "pick_dest_cell" : "scan_dest_cell",
                )
              }
            >
              I&apos;ve got them — head to shipping
            </Button>
          </section>
        )}

        {step === "pick_dest_cell" && (
          <section className="space-y-3">
            <div className="rounded-lg border border-border/60 bg-card p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Pick a shipping cell
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Tap the cell you&apos;re walking the trolley to. You&apos;ll
                scan it next to confirm.
              </p>
            </div>
            <ul className="space-y-1.5">
              {suggestions.map((c) => {
                const label = cellDisplayLabel(c);
                const path = [c.floor, c.location].filter(Boolean).join(" · ");
                return (
                  <li key={c.uuid}>
                    <button
                      type="button"
                      onClick={() => {
                        setPickedDestCell(c);
                        setDestCellUuid(c.uuid);
                        // Show the floor plan next when we have the
                        // UUIDs the FloorPlanMini needs; otherwise
                        // skip straight to scan (rare — a cell with
                        // no floor/location wouldn't normally be
                        // in the suggestions list).
                        setStep(
                          c.floor_uuid && c.location_uuid
                            ? "walk_to_dest"
                            : "scan_dest_cell",
                        );
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 bg-card p-3 text-left active:bg-muted"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{label}</p>
                        {path && (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {path}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 rounded-md bg-brand/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand">
                        Pick
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => {
                setPickedDestCell(null);
                setDestCellUuid(null);
                setStep("scan_dest_cell");
              }}
              className="w-full rounded-lg border border-dashed border-border/60 bg-transparent p-3 text-xs text-muted-foreground active:bg-muted"
            >
              None of these — scan any dispatch cell instead
            </button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => setStep("confirm_pick")}
            >
              Back to pick
            </Button>
          </section>
        )}

        {step === "walk_to_dest" && pickedDestCell && (
          <section className="space-y-3">
            <div className="rounded-lg border border-border/60 bg-card p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Walk to
              </p>
              <p className="mt-1 text-sm font-semibold">
                {cellDisplayLabel(pickedDestCell)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {[pickedDestCell.floor, pickedDestCell.location]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>

            {pickedDestCell.floor_uuid && pickedDestCell.location_uuid && (
              <FloorPlanMini
                floorUuid={pickedDestCell.floor_uuid}
                targetLocationUuid={pickedDestCell.location_uuid}
              />
            )}

            <p className="text-xs text-muted-foreground">
              Tap the button when you&apos;re at the cell — you&apos;ll scan
              the QR next to confirm you&apos;re at the right shelf.
            </p>

            <Button
              className="w-full"
              size="lg"
              onClick={() => setStep("scan_dest_cell")}
            >
              I&apos;m at the cell — scan it
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => setStep("pick_dest_cell")}
            >
              Pick a different cell
            </Button>
          </section>
        )}

        {step === "scan_dest_cell" && (
          <>
            <UuidScanStep
              expectedUuid={pickedDestCell?.uuid ?? "*"}
              kind="cell"
              expectedLabel={
                pickedDestCell
                  ? cellDisplayLabel(pickedDestCell)
                  : "Any dispatch cell in this warehouse"
              }
              bypassUuid={pickedDestCell?.uuid}
              onConfirmed={() => {
                // Freeform "Scan any cell" branch: the scanner
                // reports the scanned uuid via onScanned; specific-
                // uuid branch already stashed it when the picker
                // tapped the suggestion. Either way we now have
                // destCellUuid to submit.
                const toCell = pickedDestCell?.uuid ?? destCellUuid;
                if (toCell) submitMove(toCell);
              }}
              onCancel={() =>
                setStep(
                  pickedDestCell
                    ? "walk_to_dest"
                    : suggestions.length > 0
                      ? "pick_dest_cell"
                      : "confirm_pick",
                )
              }
              onScanned={(uuid) => setDestCellUuid(uuid)}
            />
            {pending && (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-card p-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Moving to shipping and queuing the shipment…
              </div>
            )}
            {error && <ErrorBanner detail={error.detail} code={error.code} />}
          </>
        )}
      </main>
    </div>
  );
}

const STEPS: { key: Step; short: string }[] = [
  { key: "scan_source_cell", short: "Cell" },
  { key: "scan_lot", short: "Lot" },
  { key: "confirm_pick", short: "Pick" },
  { key: "pick_dest_cell", short: "Ship" },
  { key: "walk_to_dest", short: "Walk" },
  { key: "scan_dest_cell", short: "Drop" },
];

function cellDisplayLabel(c: {
  name: string | null;
  code: string | null;
  ordinal: number | null;
}): string {
  return (
    c.name?.trim() ||
    c.code?.trim() ||
    (typeof c.ordinal === "number" ? `Level ${c.ordinal + 1}` : "Cell")
  );
}

function ContextRow({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={`truncate text-xs ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function locationLabel(
  loc: { name: string | null; code: string | null } | null,
): string {
  if (!loc) return "—";
  return loc.name?.trim() || loc.code?.trim() || "—";
}

function cellLabel(
  cell: { name: string | null; code: string | null; ordinal: number } | null,
): string {
  if (!cell) return "—";
  return (
    cell.name?.trim() ||
    cell.code?.trim() ||
    (typeof cell.ordinal === "number" ? `Level ${cell.ordinal + 1}` : "—")
  );
}

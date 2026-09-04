"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  MapPin,
  Package,
  Truck,
  Undo2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/forms/error-banner";
import { completeReturnAction } from "@/lib/three-pl/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type { PendingReturn } from "@/lib/three-pl/types";
import { UuidScanStep } from "../../pickup/[mo_uuid]/uuid-scan-step";
import { FloorPlanMini } from "../../lots/[uuid]/move/floor-plan-mini";

type Step =
  | "scan_source_cell"
  | "scan_lot"
  | "confirm_pick"
  | "walk_to_dest"
  | "scan_dest_cell";

/**
 * Mobile 3PL return-walk flow. Mirror of the outbound
 * DispatchFlow but with a fixed destination — the original 3PL
 * cell captured on the Dispatch at complete_dispatch time (or
 * scanner-freeform when the legacy pre-migration dispatch has no
 * remembered target).
 *
 * Steps:
 *   1. Scan source dispatch cell (where the lot IS now).
 *   2. Scan lot QR (must match).
 *   3. Confirm pick — "I've got them, walk it back".
 *   4. Walk to bailee cell — FloorPlanMini highlights the target.
 *   5. Scan destination — armed against the target uuid + dev
 *      Skip-scan bypass. On confirm we POST /complete which fires
 *      Stock.Movement (dispatch → 3PL) + flips Dispatch to
 *      ``cancelled`` in one txn.
 */
export function ReturnFlow({ dispatch }: { dispatch: PendingReturn }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("scan_source_cell");
  const [destCellUuid, setDestCellUuid] = useState<string | null>(
    dispatch.return_target?.uuid ?? null,
  );
  const [error, setError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  const lot = dispatch.lot;
  const unit = lot?.unit_symbol ?? "";
  const sourceCell = dispatch.source_cell;
  const sourceCellLabel = cellLabel(sourceCell);
  const sourceLocLabel = locationLabel(dispatch.source_location);
  const target = dispatch.return_target;

  const submitReturn = useCallback(
    (toCellUuid: string) => {
      setError(null);
      startTransition(async () => {
        const res = await completeReturnAction(dispatch.uuid, {
          to_cell_uuid: toCellUuid,
        });
        if (!res.ok) {
          setError(res);
          return;
        }
        toast.success("Returned to bailee custody.");
        // Hard-nav so the RSC payload for the hub reloads from
        // scratch — router.push alone reuses the cached tree and
        // the just-completed row would linger on the Return tab.
        window.location.assign("/m/three-pl-dispatches?tab=return");
      });
    },
    [dispatch.uuid, router],
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-3">
        <Link
          href="/m/three-pl-dispatches?tab=return"
          className="rounded-md p-1.5 text-muted-foreground active:bg-muted"
          aria-label="Back to queue"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-wider text-muted-foreground">
            3PL return
          </p>
          <p className="truncate text-sm font-semibold">
            {dispatch.qty}
            {unit ? ` ${unit}` : ""} of {lot?.item?.name ?? "—"}
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-3 px-3 py-4">
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
              label="From"
              value={`${sourceLocLabel} · ${sourceCellLabel}`}
            />
            <ContextRow
              icon={<Undo2 className="size-3.5" />}
              label="Back to"
              value={target ? cellDisplayLabel(target) : "any 3PL cell"}
            />
          </div>
        </section>

        <div className="flex items-center justify-between gap-1 text-[10px]">
          {STEPS.map((s, i) => {
            const stepIdx = STEPS.findIndex((x) => x.key === step);
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
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-orange-500/10">
              <Undo2 className="size-7 text-orange-600" />
            </div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Take from this cell
            </p>
            <p className="font-mono text-4xl font-semibold">
              {dispatch.qty}
              {unit ? ` ${unit}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Load them on the trolley and walk back to bailee custody.
            </p>
            <Button
              className="w-full"
              size="lg"
              onClick={() => setStep("walk_to_dest")}
            >
              I&apos;ve got them — walk back
            </Button>
          </section>
        )}

        {step === "walk_to_dest" && target && (
          <section className="space-y-3">
            <div className="rounded-lg border border-border/60 bg-card p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Walk to
              </p>
              <p className="mt-1 text-sm font-semibold">
                {cellDisplayLabel(target)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {[target.floor, target.location].filter(Boolean).join(" · ")}
              </p>
            </div>

            {target.floor_uuid && target.location_uuid && (
              <FloorPlanMini
                floorUuid={target.floor_uuid}
                targetLocationUuid={target.location_uuid}
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
              onClick={() => setStep("confirm_pick")}
            >
              Back to pick
            </Button>
          </section>
        )}

        {step === "walk_to_dest" && !target && (
          // Legacy pre-migration dispatch — no remembered cell.
          // Skip straight into freeform scan; backend enforces the
          // target-must-be-a-3PL-cell rule.
          <section className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-xs">
            <p className="font-medium text-amber-800 dark:text-amber-200">
              No original cell on file — scan any bailee shelf in this
              warehouse.
            </p>
            <Button
              className="w-full"
              size="lg"
              onClick={() => setStep("scan_dest_cell")}
            >
              Scan bailee cell
            </Button>
          </section>
        )}

        {step === "scan_dest_cell" && (
          <>
            <UuidScanStep
              expectedUuid={target?.uuid ?? "*"}
              kind="cell"
              expectedLabel={
                target
                  ? cellDisplayLabel(target)
                  : "Any 3PL cell in this warehouse"
              }
              bypassUuid={target?.uuid}
              onConfirmed={() => {
                const toCell = target?.uuid ?? destCellUuid;
                if (toCell) submitReturn(toCell);
              }}
              onCancel={() =>
                setStep(target ? "walk_to_dest" : "confirm_pick")
              }
              onScanned={(uuid) => setDestCellUuid(uuid)}
            />
            {pending && (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-card p-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Moving back to bailee custody…
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

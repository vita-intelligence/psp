"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Cog,
  Layers,
  Loader2,
  MapPin,
  ScanLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchPicker } from "@/components/forms/search-picker";
import { FloorPlanMini } from "@/components/warehouses/floor-plan-mini";
import { CellScanStep } from "@/app/m/lots/[uuid]/move/cell-scan-step";
import {
  storageCellPickerFetcher,
  type StorageCellPickerOption,
} from "@/lib/storage-cells/picker-client";
import { moveEquipmentAction } from "@/lib/equipment/actions";
import type { Equipment } from "@/lib/equipment/types";
import type { ScannedCell } from "@/lib/types";

// The mobile equipment move flow follows the same skeleton as the
// lot move flow — mode toggle up front, then a per-mode wizard:
//
//   * mode = cell:  pick → directions → verify-scan → auto-submit
//   * mode = off_floor: describe → submit
//
// Scan verification is deliberately kept because the operator
// physically walked to the shelf — the camera confirms they're at
// the right one before we mutate the ledger. That's the piece the
// desktop dialog can't do.
type Step =
  | "mode"
  | "pick-cell"
  | "directions"
  | "verify-scan"
  | "off-floor";

interface Props {
  equipment: Equipment;
}

export function MoveFlow({ equipment }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState<Step>("mode");
  const [cell, setCell] = useState<StorageCellPickerOption | null>(null);
  const [description, setDescription] = useState(
    equipment.location_description ?? "",
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchCells = useMemo(
    () => storageCellPickerFetcher({ limit: 25 }),
    [],
  );

  const itemName = equipment.item?.name ?? equipment.model ?? "Equipment";

  function pickMode(mode: "cell" | "off_floor") {
    setError(null);
    setStep(mode === "cell" ? "pick-cell" : "off-floor");
  }

  function onCellChosen(picked: StorageCellPickerOption) {
    setCell(picked);
    setStep("directions");
  }

  function backTo(target: Step) {
    setError(null);
    setStep(target);
  }

  async function submit(input: {
    to_cell_uuid: string | null;
    location_description: string | null;
    reason: string | null;
  }) {
    setError(null);
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        const res = await moveEquipmentAction(equipment.uuid, input);
        if (res.ok) {
          router.replace(`/m/equipment/${equipment.uuid}`);
          router.refresh();
          resolve(true);
        } else {
          setError(res.detail);
          resolve(false);
        }
      });
    });
  }

  // ── verify-scan is a full-screen camera view, so it renders
  //    outside the standard wrapper. Handled separately below.
  if (step === "verify-scan" && cell) {
    const expected: ScannedCell = {
      id: 0,
      uuid: cell.uuid,
      name: cell.label,
      code: null,
      ordinal: 0,
      tags: [],
      system_kind: null,
      storage_location: {
        id: 0,
        uuid: cell.locationUuid,
        name: cell.locationName,
        code: null,
      },
      floor: { id: 0, uuid: cell.floorUuid, name: cell.floorName },
      warehouse: { id: 0, uuid: cell.warehouseUuid, name: cell.warehouseName },
    };

    return (
      <div className="flex min-h-svh flex-col">
        <div className="flex items-center gap-2 border-b border-white/10 bg-black px-4 py-3 text-white">
          <button
            type="button"
            onClick={() => setStep("directions")}
            className="inline-flex items-center gap-1 text-xs"
            disabled={pending}
          >
            <ChevronLeft className="size-3.5" />
            Back
          </button>
          <span className="ml-auto text-xs uppercase tracking-wider text-white/70">
            Step 3 of 3
          </span>
        </div>

        <CellScanStep
          expected={expected}
          onResult={(scanned) => {
            // CellScanStep only calls onResult on a matching scan
            // (or an explicit override). Either way, commit the move
            // to the scanned cell — same posture as the lot flow.
            submit({
              to_cell_uuid: scanned.uuid,
              location_description: null,
              reason: reason.trim() || null,
            });
          }}
          onError={(msg) => setError(msg)}
        />

        {error ? (
          <div className="border-t border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-200">
            {error}
          </div>
        ) : null}
      </div>
    );
  }

  // ── all other steps share the same padded card layout ──────────

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <Link
          href={`/m/equipment/${equipment.uuid}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        >
          <ChevronLeft className="size-3.5" />
          Back
        </Link>
        {step !== "mode" ? (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {step === "pick-cell"
              ? "Step 1 of 3"
              : step === "directions"
                ? "Step 2 of 3"
                : step === "off-floor"
                  ? "Off the floor"
                  : ""}
          </span>
        ) : null}
      </div>

      {/* Header pill so the operator always sees which unit they're
          moving — mirrors the lot flow's persistent identity bar. */}
      <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3">
        <span className="grid size-9 place-items-center rounded-full bg-muted">
          <Cog className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{itemName}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {equipment.serial_number}
          </p>
        </div>
      </div>

      {step === "mode" ? (
        <ModeStep
          onPick={pickMode}
          currentCellName={equipment.current_cell?.name ?? null}
          currentLocationDesc={equipment.location_description ?? null}
        />
      ) : null}

      {step === "pick-cell" ? (
        <PickStep
          fetchCells={fetchCells}
          cell={cell}
          onPick={onCellChosen}
          onBack={() => backTo("mode")}
        />
      ) : null}

      {step === "directions" && cell ? (
        <DirectionsStep
          cell={cell}
          reason={reason}
          onReasonChange={setReason}
          onBack={() => backTo("pick-cell")}
          onScan={() => setStep("verify-scan")}
          onSkipScan={() =>
            submit({
              to_cell_uuid: cell.uuid,
              location_description: null,
              reason: reason.trim() || null,
            })
          }
          pending={pending}
        />
      ) : null}

      {step === "off-floor" ? (
        <OffFloorStep
          description={description}
          onDescriptionChange={setDescription}
          reason={reason}
          onReasonChange={setReason}
          pending={pending}
          onBack={() => backTo("mode")}
          onSubmit={() =>
            submit({
              to_cell_uuid: null,
              location_description: description.trim() || null,
              reason: reason.trim() || null,
            })
          }
        />
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Step components
// ─────────────────────────────────────────────────────────────────

function ModeStep({
  onPick,
  currentCellName,
  currentLocationDesc,
}: {
  onPick: (mode: "cell" | "off_floor") => void;
  currentCellName: string | null;
  currentLocationDesc: string | null;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Where is this unit going?
      </p>

      <button
        type="button"
        onClick={() => onPick("cell")}
        className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-4 text-left active:bg-muted"
      >
        <span className="grid size-9 place-items-center rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-400">
          <MapPin className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">In a storage cell</p>
          <p className="text-xs text-muted-foreground">
            Pick a cell, walk there, scan the shelf QR to confirm.
          </p>
        </div>
        <ChevronRight className="size-4 text-muted-foreground" />
      </button>

      <button
        type="button"
        onClick={() => onPick("off_floor")}
        className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-4 text-left active:bg-muted"
      >
        <span className="grid size-9 place-items-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400">
          <Building2 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Off the floor</p>
          <p className="text-xs text-muted-foreground">
            Office / wall / reception. Free-text location.
          </p>
        </div>
        <ChevronRight className="size-4 text-muted-foreground" />
      </button>

      {currentCellName || currentLocationDesc ? (
        <p className="pt-1 text-[11px] text-muted-foreground">
          Currently:{" "}
          <span className="text-foreground">
            {currentCellName ?? currentLocationDesc}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function PickStep({
  fetchCells,
  cell,
  onPick,
  onBack,
}: {
  fetchCells: (
    q: string,
    signal?: AbortSignal,
  ) => Promise<StorageCellPickerOption[]>;
  cell: StorageCellPickerOption | null;
  onPick: (picked: StorageCellPickerOption) => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Search or scroll to pick the destination cell. Tap a row to
        continue — you'll get walking directions next.
      </p>

      <SearchPicker<StorageCellPickerOption>
        fetcher={fetchCells}
        value={cell}
        onChange={(next) => {
          if (next) onPick(next);
        }}
        placeholder="Search cell, location, or warehouse…"
        emptyHint="No matching cells."
      />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="w-full"
      >
        <ChevronLeft className="mr-1 size-3.5" />
        Change mode
      </Button>
    </div>
  );
}

function DirectionsStep({
  cell,
  reason,
  onReasonChange,
  onBack,
  onScan,
  onSkipScan,
  pending,
}: {
  cell: StorageCellPickerOption;
  reason: string;
  onReasonChange: (v: string) => void;
  onBack: () => void;
  onScan: () => void;
  onSkipScan: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-brand/40 bg-brand/5 p-3">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-brand">
          <MapPin className="size-3" />
          Walk to this cell
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
          <Building2 className="size-3.5 text-muted-foreground" />
          <span className="font-medium">{cell.warehouseName}</span>
          <span className="text-muted-foreground">/</span>
          <Layers className="size-3.5 text-muted-foreground" />
          <span>{cell.floorName}</span>
          <span className="text-muted-foreground">/</span>
          <span>{cell.locationName}</span>
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold">{cell.label}</span>
        </div>

        <div className="mt-3">
          <FloorPlanMini
            floorUuid={cell.floorUuid}
            targetLocationUuid={cell.locationUuid}
            apiPath={(floorUuid) =>
              `/api/stock/floors/${encodeURIComponent(floorUuid)}/plan`
            }
            heightClassName="h-48"
            footerLabel="Pinned rack is where the unit is going."
          />
        </div>
      </div>

      <div>
        <Label htmlFor="move-reason" className="text-xs">
          Reason (optional)
        </Label>
        <Textarea
          id="move-reason"
          rows={2}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="e.g. Reassigning to line 2 after refurb."
          className="mt-1"
        />
      </div>

      <Button
        type="button"
        onClick={onScan}
        disabled={pending}
        className="h-12 w-full"
        size="lg"
      >
        <ScanLine className="mr-2 size-4" />
        Scan the shelf QR to confirm
      </Button>

      <Button
        type="button"
        variant="ghost"
        onClick={onSkipScan}
        disabled={pending}
        className="h-10 w-full text-xs"
      >
        {pending ? (
          <Loader2 className="mr-1 size-3.5 animate-spin" />
        ) : (
          <Check className="mr-1 size-3.5" />
        )}
        Skip scan (not on-site)
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="w-full"
        disabled={pending}
      >
        <ChevronLeft className="mr-1 size-3.5" />
        Pick a different cell
      </Button>
    </div>
  );
}

function OffFloorStep({
  description,
  onDescriptionChange,
  reason,
  onReasonChange,
  pending,
  onBack,
  onSubmit,
}: {
  description: string;
  onDescriptionChange: (v: string) => void;
  reason: string;
  onReasonChange: (v: string) => void;
  pending: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Free-text location — used when the unit isn't on a mapped
        storage cell (office monitors, wall displays, meter
        cupboards).
      </p>

      <div>
        <Label htmlFor="off-desc" className="text-xs">
          Location description
        </Label>
        <Input
          id="off-desc"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Reception wall · Boardroom · IT cupboard"
          className="mt-1 h-11 text-base"
          autoFocus
        />
      </div>

      <div>
        <Label htmlFor="off-reason" className="text-xs">
          Reason (optional)
        </Label>
        <Textarea
          id="off-reason"
          rows={2}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          className="mt-1"
        />
      </div>

      <Button
        type="button"
        onClick={onSubmit}
        disabled={pending || !description.trim()}
        className="h-12 w-full"
        size="lg"
      >
        {pending ? (
          <Loader2 className="mr-1.5 size-4 animate-spin" />
        ) : (
          <Check className="mr-1.5 size-4" />
        )}
        Record location
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="w-full"
        disabled={pending}
      >
        <ChevronLeft className="mr-1 size-3.5" />
        Change mode
      </Button>
    </div>
  );
}

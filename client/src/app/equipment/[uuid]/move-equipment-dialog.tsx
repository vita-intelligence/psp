"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Layers, Loader2, MapPin, Move } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchPicker } from "@/components/forms/search-picker";
import { FloorPlanMini } from "@/components/warehouses/floor-plan-mini";
import {
  storageCellPickerFetcher,
  type StorageCellPickerOption,
} from "@/lib/storage-cells/picker-client";
import { moveEquipmentAction } from "@/lib/equipment/actions";
import type { Equipment } from "@/lib/equipment/types";

interface Props {
  equipment: Equipment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Mode = "cell" | "off_floor";

/**
 * Move an equipment unit to a storage cell OR mark it "off the
 * floor" with a free-text location. Wraps the ``moved`` lifecycle
 * event so the timeline captures the transition. Backend clears
 * `location_description` automatically when a real cell is picked.
 *
 * Two modes because "off the floor" needs a description ("Reception
 * wall", "Boardroom north"), and "in a cell" needs a cell picker —
 * cramming both into one control was confusing.
 */
export function MoveEquipmentDialog({ equipment, open, onOpenChange }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("cell");
  const [cell, setCell] = useState<StorageCellPickerOption | null>(null);
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");

  const fetchCells = useMemo(
    () => storageCellPickerFetcher({ limit: 25 }),
    [],
  );

  useEffect(() => {
    if (!open) return;
    // Reset every time the dialog opens for a different unit.
    setMode(equipment?.current_cell ? "cell" : "off_floor");
    setCell(null);
    setDescription(equipment?.location_description ?? "");
    setReason("");
  }, [open, equipment?.uuid]);

  if (!equipment) return null;

  function onConfirm() {
    if (!equipment) return;
    startTransition(async () => {
      const payload =
        mode === "cell"
          ? {
              to_cell_uuid: cell?.uuid ?? null,
              location_description: null,
              reason: reason.trim() || null,
            }
          : {
              to_cell_uuid: null,
              location_description: description.trim() || null,
              reason: reason.trim() || null,
            };

      if (mode === "cell" && !payload.to_cell_uuid) {
        toast.error("Pick a storage cell.");
        return;
      }

      const res = await moveEquipmentAction(equipment.uuid, payload);
      if (res.ok) {
        toast.success("Move recorded — timeline updated.");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move equipment</DialogTitle>
          <DialogDescription>
            {equipment.item?.name ?? equipment.model ?? "This unit"} ·{" "}
            <span className="font-mono">{equipment.serial_number}</span>
            <br />
            Where is it going? A cell for plant kit; a free-text
            location for office kit that doesn't live on a shelf.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Segmented mode toggle */}
          <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-1 text-xs">
            <button
              type="button"
              onClick={() => setMode("cell")}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                mode === "cell"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              In a storage cell
            </button>
            <button
              type="button"
              onClick={() => setMode("off_floor")}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                mode === "off_floor"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              Off the floor (office / wall)
            </button>
          </div>

          {mode === "cell" ? (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Destination cell</Label>
                <div className="mt-1">
                  <SearchPicker<StorageCellPickerOption>
                    fetcher={fetchCells}
                    value={cell}
                    onChange={setCell}
                    placeholder="Search cell, location, or warehouse…"
                    emptyHint="No matching cells."
                    disabled={pending}
                  />
                </div>
                {equipment.current_cell && !cell ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Currently in{" "}
                    <span className="font-medium text-foreground">
                      {equipment.current_cell.name}
                    </span>
                    {equipment.current_cell.warehouse?.name
                      ? ` · ${equipment.current_cell.warehouse.name}`
                      : ""}
                    .
                  </p>
                ) : null}
              </div>

              {/* Breadcrumb + floor-plan preview once a cell is
                  picked — same "Walk to this shelf" panel the lot
                  move flow uses so operators recognise the pattern. */}
              {cell ? (
                <div className="rounded-md border border-brand/40 bg-brand/5 p-3 text-xs">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-brand">
                    <MapPin className="size-3" />
                    Destination
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-sm font-medium">
                    <Building2 className="size-3.5 text-muted-foreground" />
                    <span>{cell.warehouseName}</span>
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
                      heightClassName="h-40"
                      footerLabel="Pinned rack is where the unit is going."
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div>
              <Label htmlFor="move-desc" className="text-xs">
                Location description
              </Label>
              <Input
                id="move-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Reception wall · Boardroom · IT cupboard"
                className="mt-1"
                autoFocus
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Free-text — used when the unit isn't on a mapped storage
                cell (office monitors, wall displays, meter cupboards).
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="move-reason" className="text-xs">
              Reason (optional)
            </Label>
            <Textarea
              id="move-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Reassigning to line 2 after refurb."
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={pending}>
            {pending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Move className="mr-1 h-3.5 w-3.5" />
            )}
            Record move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  cmToMetres,
  formatArea,
  formatLength,
  parseDimensionToCm,
  polygonAreaCm2,
  polygonPerimeterCm,
  wallLengthCm,
} from "./plan-utils";
import type {
  FloorOutline,
  Hole,
  LocalLocation,
  SelectionItem,
  SelectionSet,
  StorageLocationKind,
  Wall,
} from "./plan-types";
import { Info, Trash2 } from "lucide-react";

interface PlanPropertiesProps {
  selection: SelectionSet;
  outline: FloorOutline | undefined;
  walls: Wall[];
  locations: LocalLocation[];
  readOnly: boolean;
  /** Mobile layout: render as a bottom sheet body without the fixed
   *  side-panel chrome. */
  layout?: "side" | "sheet";
  onWallUpdate: (id: string, patch: Partial<Wall>) => void;
  onWallDelete: (id: string) => void;
  onOutlineDelete: () => void;
  onHoleUpdate: (id: string, patch: Partial<Hole>) => void;
  onHoleDelete: (id: string) => void;
  onLocationUpdate: (
    id: string | number,
    patch: Partial<Omit<LocalLocation, "id" | "uuid" | "tempId">>,
  ) => void;
  onLocationDelete: (id: string | number) => void;
  onDeleteSelected: () => void;
}

const KIND_OPTIONS: Array<{ value: StorageLocationKind; label: string }> = [
  { value: "rack", label: "Rack" },
  { value: "shelf", label: "Shelf" },
  { value: "pallet_zone", label: "Pallet zone" },
  { value: "cold_storage", label: "Cold storage" },
  { value: "hazmat", label: "Hazmat" },
  { value: "staging", label: "Staging" },
  { value: "other", label: "Other" },
];

/**
 * Right-side properties panel (desktop) / bottom sheet body
 * (mobile). Renders a different form per selection kind:
 *
 *   • none       — keyboard shortcut cheatsheet
 *   • outline    — vertex count, perimeter, area, hole count
 *   • hole       — vertex count, area, delete
 *   • wall       — length, end-point dimension inputs (in m)
 *   • location   — name, code, kind, canvas size in m, depth, notes
 */
export function PlanProperties(props: PlanPropertiesProps) {
  const {
    selection,
    outline,
    walls,
    locations,
    readOnly,
    layout = "side",
    onWallUpdate,
    onWallDelete,
    onOutlineDelete,
    onHoleUpdate,
    onHoleDelete,
    onLocationUpdate,
    onLocationDelete,
    onDeleteSelected,
  } = props;

  let body: React.ReactNode;
  let title: string;

  if (selection.length === 0) {
    title = "No selection";
    body = <NoSelectionBody />;
  } else if (selection.length > 1) {
    title = `${selection.length} selected`;
    body = (
      <MultiSelectBody
        selection={selection}
        readOnly={readOnly}
        onDelete={onDeleteSelected}
      />
    );
  } else {
    // Single-item — pick a panel by kind.
    const item = selection[0]!;
    if (item.kind === "outline") {
      title = "Floor outline";
      body = outline ? (
        <OutlineBody
          outline={outline}
          readOnly={readOnly}
          onDelete={onOutlineDelete}
        />
      ) : null;
    } else if (item.kind === "hole") {
      const hole = outline?.holes?.find((h) => h.id === item.id);
      title = "Floor cutout";
      body = hole ? (
        <HoleBody
          hole={hole}
          readOnly={readOnly}
          onDelete={() => onHoleDelete(hole.id)}
        />
      ) : null;
    } else if (item.kind === "wall") {
      const wall = walls.find((w) => w.id === item.id);
      title = "Wall";
      body = wall ? (
        <WallBody
          wall={wall}
          readOnly={readOnly}
          onUpdate={(patch) => onWallUpdate(wall.id, patch)}
          onDelete={() => onWallDelete(wall.id)}
        />
      ) : null;
    } else {
      const location = locations.find(
        (l) => (l.tempId ?? l.uuid) === item.id,
      );
      title = "Storage location";
      body = location ? (
        <LocationBody
          location={location}
          readOnly={readOnly}
          onUpdate={(patch) =>
            onLocationUpdate(location.tempId ?? location.uuid, patch)
          }
          onDelete={() => onLocationDelete(location.tempId ?? location.uuid)}
        />
      ) : null;
    }
  }
  // Silence unused-var lint when onHoleUpdate isn't called for the
  // current selection shape — the prop is still wired for future
  // hole-vertex editing.
  void onHoleUpdate;

  // Sheet variant skips the side-panel chrome — the parent
  // (mobile-bottom-sheet) already provides a sheet header.
  if (layout === "sheet") {
    return <div className="space-y-3">{body}</div>;
  }

  return (
    <div className="flex h-full w-64 shrink-0 flex-col rounded-md border border-border/60 bg-background shadow-sm">
      <div className="border-b border-border/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="flex-1 overflow-y-auto p-3">{body}</div>
    </div>
  );
}

// ---------------------------------------------------------------- bodies

function MultiSelectBody({
  selection,
  readOnly,
  onDelete,
}: {
  selection: SelectionItem[];
  readOnly: boolean;
  onDelete: () => void;
}) {
  // Count by kind for the breakdown badge row.
  const counts = selection.reduce(
    (acc, item) => {
      acc[item.kind] = (acc[item.kind] ?? 0) + 1;
      return acc;
    },
    {} as Record<SelectionItem["kind"], number>,
  );
  const labels: Record<SelectionItem["kind"], string> = {
    wall: "walls",
    outline: "floor outline",
    hole: "holes",
    location: "locations",
  };
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-md bg-muted/40 px-3 py-2 text-muted-foreground">
        <p className="font-medium text-foreground">
          {selection.length} item{selection.length === 1 ? "" : "s"} selected
        </p>
        <ul className="mt-1 space-y-0.5">
          {(Object.keys(counts) as SelectionItem["kind"][]).map((k) => (
            <li key={k}>
              {counts[k]} {counts[k] === 1 ? labels[k].replace(/s$/, "") : labels[k]}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-md border border-dashed border-border/60 px-2.5 py-2 text-[11px] text-muted-foreground">
        Click a single item to edit its individual properties.
      </div>
      {!readOnly && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="w-full justify-start text-destructive hover:text-destructive"
        >
          <Trash2 className="mr-1.5 size-3.5" />
          Delete selected
        </Button>
      )}
    </div>
  );
}

function NoSelectionBody() {
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Click any element on the canvas to edit it, or pick a tool from
          the left to draw something new.
        </span>
      </div>
      <ul className="space-y-1.5 pl-1">
        <li>
          <Kbd>V</Kbd> select · <Kbd>H</Kbd> pan
        </li>
        <li>
          <Kbd>W</Kbd> wall · <Kbd>L</Kbd> location
        </li>
        <li>
          <Kbd>F</Kbd> floor outline · <Kbd>O</Kbd> cut a hole
        </li>
        <li>
          <Kbd>Esc</Kbd> cancel · <Kbd>Del</Kbd> delete selected
        </li>
        <li>
          <Kbd>Ctrl/⌘ Z</Kbd> undo · <Kbd>Ctrl/⌘ Y</Kbd> redo
        </li>
        <li>
          <Kbd>Shift</Kbd>-click to add to selection · drag empty space to box-select
        </li>
      </ul>
      <div className="rounded-md border border-dashed border-border/60 px-2.5 py-2 text-[11px] text-muted-foreground">
        <strong className="font-semibold text-foreground">Tip:</strong> start
        by drawing the floor outline (F). Click vertices around the
        perimeter, then click the first vertex (or double-click) to close
        the polygon. Add walls and locations inside.
      </div>
    </div>
  );
}

function OutlineBody({
  outline,
  readOnly,
  onDelete,
}: {
  outline: FloorOutline;
  readOnly: boolean;
  onDelete: () => void;
}) {
  const perimeter = polygonPerimeterCm(outline.points);
  const area = polygonAreaCm2(outline.points);
  const holeArea = (outline.holes ?? []).reduce(
    (sum, h) => sum + polygonAreaCm2(h.points),
    0,
  );
  const walkable = Math.max(0, area - holeArea);

  return (
    <div className="space-y-3">
      <Row label="Vertices">
        <span className="font-mono text-xs">{outline.points.length}</span>
      </Row>
      <Row label="Perimeter">
        <span className="font-mono text-xs">{formatLength(perimeter)}</span>
      </Row>
      <Row label="Area">
        <span className="font-mono text-xs">{formatArea(area)}</span>
      </Row>
      <Row label="Holes">
        <span className="font-mono text-xs">{outline.holes?.length ?? 0}</span>
      </Row>
      {(outline.holes?.length ?? 0) > 0 && (
        <Row label="Walkable area">
          <span className="font-mono text-xs">{formatArea(walkable)}</span>
        </Row>
      )}
      <div className="rounded-md bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground">
        Need a stairwell or atrium? Switch to{" "}
        <strong className="font-semibold text-foreground">Cut a hole</strong>{" "}
        (
        <Kbd>O</Kbd>) and trace the cutout inside the outline.
      </div>
      {!readOnly && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="w-full justify-start text-destructive hover:text-destructive"
        >
          <Trash2 className="mr-1.5 size-3.5" />
          Delete outline (and all holes)
        </Button>
      )}
    </div>
  );
}

function HoleBody({
  hole,
  readOnly,
  onDelete,
}: {
  hole: Hole;
  readOnly: boolean;
  onDelete: () => void;
}) {
  const area = polygonAreaCm2(hole.points);
  const perimeter = polygonPerimeterCm(hole.points);
  return (
    <div className="space-y-3">
      <Row label="Vertices">
        <span className="font-mono text-xs">{hole.points.length}</span>
      </Row>
      <Row label="Perimeter">
        <span className="font-mono text-xs">{formatLength(perimeter)}</span>
      </Row>
      <Row label="Area">
        <span className="font-mono text-xs">{formatArea(area)}</span>
      </Row>
      <div className="rounded-md bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground">
        Holes are non-walkable areas inside the floor — stairwells,
        atriums, lift shafts.
      </div>
      {!readOnly && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="w-full justify-start text-destructive hover:text-destructive"
        >
          <Trash2 className="mr-1.5 size-3.5" />
          Delete hole
        </Button>
      )}
    </div>
  );
}

function WallBody({
  wall,
  readOnly,
  onUpdate,
  onDelete,
}: {
  wall: Wall;
  readOnly: boolean;
  onUpdate: (patch: Partial<Wall>) => void;
  onDelete: () => void;
}) {
  const length = wallLengthCm(wall);
  return (
    <fieldset disabled={readOnly} className="contents">
      <div className="space-y-3">
        <Row label="Length">
          <span className="font-mono text-xs">{formatLength(length)}</span>
        </Row>
        <Row label="Start (m)">
          <span className="font-mono text-[11px] text-muted-foreground">
            ({cmToMetres(wall.x1).toFixed(2)},{" "}
            {cmToMetres(wall.y1).toFixed(2)})
          </span>
        </Row>
        <Row label="End (m)">
          <div className="grid grid-cols-2 gap-1.5">
            <MetresInput
              valueCm={wall.x2}
              onChange={(cm) => cm !== null && onUpdate({ x2: cm })}
            />
            <MetresInput
              valueCm={wall.y2}
              onChange={(cm) => cm !== null && onUpdate({ y2: cm })}
            />
          </div>
        </Row>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="w-full justify-start text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Delete wall
          </Button>
        )}
      </div>
    </fieldset>
  );
}

function LocationBody({
  location,
  readOnly,
  onUpdate,
  onDelete,
}: {
  location: LocalLocation;
  readOnly: boolean;
  onUpdate: (
    patch: Partial<Omit<LocalLocation, "id" | "uuid" | "tempId">>,
  ) => void;
  onDelete: () => void;
}) {
  return (
    <fieldset disabled={readOnly} className="contents">
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="loc-name" className="text-xs">
            Name
          </Label>
          <Input
            id="loc-name"
            value={location.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            maxLength={120}
            className="h-8 text-xs"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="loc-code" className="text-xs">
              Code
            </Label>
            <Input
              id="loc-code"
              value={location.code ?? ""}
              onChange={(e) =>
                onUpdate({ code: e.target.value || null })
              }
              placeholder="A-12"
              maxLength={40}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Kind</Label>
            <Select
              value={location.kind ?? ""}
              onValueChange={(v) =>
                onUpdate({ kind: (v || null) as StorageLocationKind | null })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Pick…" />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Row label="Footprint (m)">
          <div className="grid grid-cols-2 gap-1.5">
            <MetresInput
              valueCm={location.width}
              onChange={(cm) =>
                cm !== null && onUpdate({ width: Math.max(20, cm) })
              }
              placeholder="W"
            />
            <MetresInput
              valueCm={location.height}
              onChange={(cm) =>
                cm !== null && onUpdate({ height: Math.max(20, cm) })
              }
              placeholder="D"
            />
          </div>
        </Row>

        <div className="space-y-1">
          <Label htmlFor="loc-depth" className="text-xs">
            Height / vertical depth (m)
          </Label>
          <MetresInput
            valueCm={
              location.depth_m === null || location.depth_m === undefined
                ? null
                : Number(location.depth_m) * 100
            }
            allowEmpty
            placeholder="e.g. 2.5"
            onChange={(cm) =>
              onUpdate({
                depth_m: cm === null ? null : String(cmToMetres(cm).toFixed(2)),
              })
            }
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="loc-capacity" className="text-xs">
            Capacity
          </Label>
          <Input
            id="loc-capacity"
            value={location.capacity ?? ""}
            onChange={(e) =>
              onUpdate({ capacity: e.target.value || null })
            }
            placeholder="e.g. 12 pallets"
            maxLength={60}
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="loc-notes" className="text-xs">
            Notes
          </Label>
          <Textarea
            id="loc-notes"
            value={location.notes ?? ""}
            onChange={(e) =>
              onUpdate({ notes: e.target.value || null })
            }
            rows={2}
            className="text-xs"
          />
        </div>

        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="w-full justify-start text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Delete location
          </Button>
        )}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------- atoms

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-background px-1 text-[10px] font-mono">
      {children}
    </kbd>
  );
}

/**
 * Locally-uncontrolled metres input — accepts "5.5m", "550cm", "5,5",
 * etc, debounces commit until blur to avoid fighting the user's
 * typing. Returns cm to the parent.
 */
function MetresInput({
  valueCm,
  onChange,
  placeholder,
  allowEmpty = false,
}: {
  valueCm: number | null;
  onChange: (cm: number | null) => void;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const [draft, setDraft] = useState<string>(() =>
    valueCm === null || valueCm === undefined
      ? ""
      : cmToMetres(valueCm).toFixed(2),
  );
  const [hasFocus, setHasFocus] = useState(false);

  // Sync draft when the prop changes externally (e.g. drag end)
  // unless the field has focus (don't yank the user's input).
  if (!hasFocus) {
    const formatted =
      valueCm === null || valueCm === undefined
        ? ""
        : cmToMetres(valueCm).toFixed(2);
    if (formatted !== draft) setTimeout(() => setDraft(formatted), 0);
  }

  function commit(raw: string) {
    if (raw.trim().length === 0) {
      if (allowEmpty) onChange(null);
      return;
    }
    const cm = parseDimensionToCm(raw);
    if (cm === null) {
      // Bad value — restore from prop.
      setDraft(
        valueCm === null || valueCm === undefined
          ? ""
          : cmToMetres(valueCm).toFixed(2),
      );
      return;
    }
    onChange(cm);
  }

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setHasFocus(true)}
      onBlur={() => {
        setHasFocus(false);
        commit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder={placeholder}
      className={cn(
        "h-8 font-mono text-xs",
        placeholder && "placeholder:font-sans placeholder:text-[10px]",
      )}
    />
  );
}

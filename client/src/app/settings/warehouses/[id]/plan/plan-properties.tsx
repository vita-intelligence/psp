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
  edgeArcLengthCm,
  edgeChordLengthCm,
  formatArea,
  formatLength,
  locationColor,
  parseDimensionToCm,
  polygonAreaCm2,
  polygonBbox,
  polygonPerimeterCm,
  wallArcLengthCm,
  wallLengthCm,
} from "./plan-utils";
import type {
  ArrowAnnotation,
  FloorOutline,
  Hole,
  LocalLocation,
  Point,
  SelectionItem,
  SelectionSet,
  StorageLocationKind,
  TextAnnotation,
  Wall,
} from "./plan-types";
import { History, Info, Trash2 } from "lucide-react";
import { ColorPicker } from "./plan-color-picker";
import { AuditHistoryDialog } from "@/components/audit/audit-history-dialog";

interface PlanPropertiesProps {
  selection: SelectionSet;
  outline: FloorOutline | undefined;
  walls: Wall[];
  texts: TextAnnotation[];
  arrows: ArrowAnnotation[];
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
  onOutlineUpdate: (patch: Partial<FloorOutline>) => void;
  onOutlineEdgeBowChange: (index: number, bow: number) => void;
  onHoleEdgeBowChange: (holeId: string, index: number, bow: number) => void;
  onTextUpdate: (id: string, patch: Partial<TextAnnotation>) => void;
  onTextDelete: (id: string) => void;
  onArrowUpdate: (id: string, patch: Partial<ArrowAnnotation>) => void;
  onArrowDelete: (id: string) => void;
  onSelectionColor: (color: string | null) => void;
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
    texts,
    arrows,
    locations,
    readOnly,
    layout = "side",
    onWallUpdate,
    onWallDelete,
    onOutlineDelete,
    onHoleUpdate,
    onHoleDelete,
    onOutlineUpdate,
    onOutlineEdgeBowChange,
    onHoleEdgeBowChange,
    onTextUpdate,
    onTextDelete,
    onArrowUpdate,
    onArrowDelete,
    onSelectionColor,
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
        onColorChange={onSelectionColor}
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
          onUpdate={onOutlineUpdate}
          onDelete={onOutlineDelete}
        />
      ) : null;
    } else if (item.kind === "outline-edge") {
      title = `Edge ${item.index + 1}`;
      body =
        outline && outline.points.length >= 3 ? (
          <PolygonEdgeBody
            p1={outline.points[item.index]!}
            p2={
              outline.points[(item.index + 1) % outline.points.length]!
            }
            bow={outline.edgeBows?.[item.index] ?? 0}
            readOnly={readOnly}
            onBowChange={(b) => onOutlineEdgeBowChange(item.index, b)}
          />
        ) : null;
    } else if (item.kind === "hole") {
      const hole = outline?.holes?.find((h) => h.id === item.id);
      title = "Floor cutout";
      body = hole ? (
        <HoleBody
          hole={hole}
          readOnly={readOnly}
          onUpdate={(patch) => onHoleUpdate(hole.id, patch)}
          onDelete={() => onHoleDelete(hole.id)}
        />
      ) : null;
    } else if (item.kind === "hole-edge") {
      const hole = outline?.holes?.find((h) => h.id === item.holeId);
      title = `Cutout edge ${item.index + 1}`;
      body =
        hole && hole.points.length >= 3 ? (
          <PolygonEdgeBody
            p1={hole.points[item.index]!}
            p2={hole.points[(item.index + 1) % hole.points.length]!}
            bow={hole.edgeBows?.[item.index] ?? 0}
            readOnly={readOnly}
            onBowChange={(b) =>
              onHoleEdgeBowChange(hole.id, item.index, b)
            }
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
    } else if (item.kind === "text") {
      const text = texts.find((t) => t.id === item.id);
      title = "Text";
      body = text ? (
        <TextBody
          text={text}
          readOnly={readOnly}
          onUpdate={(patch) => onTextUpdate(text.id, patch)}
          onDelete={() => onTextDelete(text.id)}
        />
      ) : null;
    } else if (item.kind === "arrow") {
      const arrow = arrows.find((a) => a.id === item.id);
      title = "Arrow";
      body = arrow ? (
        <ArrowBody
          arrow={arrow}
          readOnly={readOnly}
          onUpdate={(patch) => onArrowUpdate(arrow.id, patch)}
          onDelete={() => onArrowDelete(arrow.id)}
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
  onColorChange,
  onDelete,
}: {
  selection: SelectionItem[];
  readOnly: boolean;
  onColorChange: (color: string | null) => void;
  onDelete: () => void;
}) {
  // outline-edge / hole-edge entries are sub-handles, not paintable.
  const paintableCount = selection.filter(
    (s) =>
      s.kind === "wall" ||
      s.kind === "outline" ||
      s.kind === "hole" ||
      s.kind === "location" ||
      s.kind === "text" ||
      s.kind === "arrow",
  ).length;
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
    "outline-edge": "outline edges",
    hole: "holes",
    "hole-edge": "cutout edges",
    location: "locations",
    text: "texts",
    arrow: "arrows",
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
      {paintableCount > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Paint {paintableCount} item{paintableCount === 1 ? "" : "s"}
          </div>
          <ColorPicker
            value={null}
            readOnly={readOnly}
            onChange={onColorChange}
          />
        </div>
      )}
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
  onUpdate,
  onDelete,
}: {
  outline: FloorOutline;
  readOnly: boolean;
  onUpdate: (patch: Partial<FloorOutline>) => void;
  onDelete: () => void;
}) {
  const perimeter = polygonPerimeterCm(outline.points);
  const area = polygonAreaCm2(outline.points);
  const holeArea = (outline.holes ?? []).reduce(
    (sum, h) => sum + polygonAreaCm2(h.points),
    0,
  );
  const walkable = Math.max(0, area - holeArea);
  const bbox = polygonBbox(outline.points);

  /** Translate every outline point AND every hole point by (dx, dy).
   *  Holes are nested inside the outline so we keep them in lock-step
   *  with the perimeter — otherwise editing X / Y would leave a
   *  stairwell floating outside the new outline position. */
  const translate = (dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    onUpdate({
      points: outline.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      holes: outline.holes?.map((h) => ({
        ...h,
        points: h.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      })),
    });
  };

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
      {bbox && (
        <Row label="Position (m)">
          <div className="grid grid-cols-2 gap-1.5">
            <MetresInput
              valueCm={bbox.x}
              onChange={(cm) => cm !== null && translate(cm - bbox.x, 0)}
              placeholder="X"
            />
            <MetresInput
              valueCm={bbox.y}
              onChange={(cm) => cm !== null && translate(0, cm - bbox.y)}
              placeholder="Y"
            />
          </div>
        </Row>
      )}
      {(outline.holes?.length ?? 0) > 0 && (
        <Row label="Walkable area">
          <span className="font-mono text-xs">{formatArea(walkable)}</span>
        </Row>
      )}
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Floor colour
        </div>
        <ColorPicker
          value={outline.color ?? null}
          defaultColor="#f1f5f9"
          readOnly={readOnly}
          onChange={(c) =>
            onUpdate({ color: c === null ? undefined : c })
          }
        />
      </div>
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
  onUpdate,
  onDelete,
}: {
  hole: Hole;
  readOnly: boolean;
  onUpdate: (patch: Partial<Hole>) => void;
  onDelete: () => void;
}) {
  const area = polygonAreaCm2(hole.points);
  const perimeter = polygonPerimeterCm(hole.points);
  const bbox = polygonBbox(hole.points);
  const translate = (dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    onUpdate({
      points: hole.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    });
  };
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
      {bbox && (
        <Row label="Position (m)">
          <div className="grid grid-cols-2 gap-1.5">
            <MetresInput
              valueCm={bbox.x}
              onChange={(cm) => cm !== null && translate(cm - bbox.x, 0)}
              placeholder="X"
            />
            <MetresInput
              valueCm={bbox.y}
              onChange={(cm) => cm !== null && translate(0, cm - bbox.y)}
              placeholder="Y"
            />
          </div>
        </Row>
      )}
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Outline colour
        </div>
        <ColorPicker
          value={hole.color ?? null}
          defaultColor="#ef4444"
          readOnly={readOnly}
          onChange={(c) =>
            onUpdate({ color: c === null ? undefined : c })
          }
        />
      </div>
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
  const bow = wall.bow ?? 0;
  // Cap the slider at ± half the chord length — beyond that the
  // bezier control point swings further than makes any architectural
  // sense (the arc loops in on itself). Minimum 1m so very short
  // walls still get a meaningful range.
  const bowRangeCm = Math.max(100, Math.round(length / 2));
  const isCurved = Math.abs(bow) > 0.5;
  const arcLength = isCurved ? wallArcLengthCm(wall) : length;
  return (
    <fieldset disabled={readOnly} className="contents">
      <div className="space-y-3">
        <Row label={isCurved ? "Arc length" : "Length"}>
          <span className="font-mono text-xs">{formatLength(arcLength)}</span>
        </Row>
        <Row label="Start (m)">
          <div className="grid grid-cols-2 gap-1.5">
            <MetresInput
              valueCm={wall.x1}
              onChange={(cm) => cm !== null && onUpdate({ x1: cm })}
            />
            <MetresInput
              valueCm={wall.y1}
              onChange={(cm) => cm !== null && onUpdate({ y1: cm })}
            />
          </div>
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
        <Row label="Curve (m)">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={-bowRangeCm}
              max={bowRangeCm}
              step={10}
              value={Math.round(bow)}
              onChange={(e) => {
                const v = Number(e.target.value);
                onUpdate({ bow: Math.abs(v) < 0.5 ? undefined : v });
              }}
              disabled={readOnly}
              className="h-1.5 flex-1 accent-primary"
            />
            <span className="w-12 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
              {cmToMetres(bow).toFixed(2)}
            </span>
          </div>
        </Row>
        {isCurved && !readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onUpdate({ bow: undefined })}
            className="w-full justify-start"
          >
            Make straight
          </Button>
        )}
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Wall colour
          </div>
          <ColorPicker
            value={wall.color ?? null}
            defaultColor="#2d2d2d"
            readOnly={readOnly}
            onChange={(c) =>
              onUpdate({ color: c === null ? undefined : c })
            }
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
            Delete wall
          </Button>
        )}
      </div>
    </fieldset>
  );
}

/** Shared body for a single polygon edge (outline or hole). Exposes
 *  the same bow controls as WallBody so curving a floor outline edge
 *  feels identical to curving a wall. */
function PolygonEdgeBody({
  p1,
  p2,
  bow,
  readOnly,
  onBowChange,
}: {
  p1: Point;
  p2: Point;
  bow: number;
  readOnly: boolean;
  onBowChange: (bow: number) => void;
}) {
  const length = edgeChordLengthCm(p1, p2);
  const bowRangeCm = Math.max(100, Math.round(length / 2));
  const isCurved = Math.abs(bow) > 0.5;
  const arcLength = isCurved ? edgeArcLengthCm(p1, p2, bow) : length;
  return (
    <fieldset disabled={readOnly} className="contents">
      <div className="space-y-3">
        <Row label={isCurved ? "Arc length" : "Length"}>
          <span className="font-mono text-xs">{formatLength(arcLength)}</span>
        </Row>
        <Row label="Start (m)">
          <span className="font-mono text-[11px] text-muted-foreground">
            ({cmToMetres(p1.x).toFixed(2)}, {cmToMetres(p1.y).toFixed(2)})
          </span>
        </Row>
        <Row label="End (m)">
          <span className="font-mono text-[11px] text-muted-foreground">
            ({cmToMetres(p2.x).toFixed(2)}, {cmToMetres(p2.y).toFixed(2)})
          </span>
        </Row>
        <Row label="Curve (m)">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={-bowRangeCm}
              max={bowRangeCm}
              step={10}
              value={Math.round(bow)}
              onChange={(e) => {
                const v = Number(e.target.value);
                onBowChange(Math.abs(v) < 0.5 ? 0 : v);
              }}
              disabled={readOnly}
              className="h-1.5 flex-1 accent-primary"
            />
            <span className="w-12 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
              {cmToMetres(bow).toFixed(2)}
            </span>
          </div>
        </Row>
        {isCurved && !readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onBowChange(0)}
            className="w-full justify-start"
          >
            Make straight
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

        <Row label="Position (m)">
          <div className="grid grid-cols-2 gap-1.5">
            <MetresInput
              valueCm={location.x}
              onChange={(cm) => cm !== null && onUpdate({ x: cm })}
              placeholder="X"
            />
            <MetresInput
              valueCm={location.y}
              onChange={(cm) => cm !== null && onUpdate({ y: cm })}
              placeholder="Y"
            />
          </div>
        </Row>

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

        <div className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Colour
          </div>
          <ColorPicker
            value={location.color ?? null}
            defaultColor={locationColor(location.kind, null)}
            readOnly={readOnly}
            onChange={(c) => onUpdate({ color: c })}
          />
        </div>

        {location.id > 0 && (
          <AuditHistoryDialog
            entityType="storage_location"
            entityId={location.id}
            title={`History · ${location.name}`}
            description="Every recorded change to this storage location."
            canRestore={false}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
              >
                <History className="mr-1.5 size-3.5" />
                View history
              </Button>
            }
          />
        )}

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

function TextBody({
  text,
  readOnly,
  onUpdate,
  onDelete,
}: {
  text: TextAnnotation;
  readOnly: boolean;
  onUpdate: (patch: Partial<TextAnnotation>) => void;
  onDelete: () => void;
}) {
  return (
    <fieldset disabled={readOnly} className="contents">
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="txt-content" className="text-xs">
            Text
          </Label>
          <Textarea
            id="txt-content"
            value={text.text}
            onChange={(e) => onUpdate({ text: e.target.value })}
            rows={3}
            className="text-xs"
            placeholder="Type your label…"
          />
        </div>
        <Row label="Position (m)">
          <div className="grid grid-cols-2 gap-1.5">
            <MetresInput
              valueCm={text.x}
              onChange={(cm) => cm !== null && onUpdate({ x: cm })}
              placeholder="X"
            />
            <MetresInput
              valueCm={text.y}
              onChange={(cm) => cm !== null && onUpdate({ y: cm })}
              placeholder="Y"
            />
          </div>
        </Row>
        <Row label="Size (m)">
          <div className="grid grid-cols-2 gap-1.5">
            <MetresInput
              valueCm={text.width}
              onChange={(cm) =>
                cm !== null && onUpdate({ width: Math.max(20, cm) })
              }
              placeholder="W"
            />
            <MetresInput
              valueCm={text.height}
              onChange={(cm) =>
                cm !== null && onUpdate({ height: Math.max(20, cm) })
              }
              placeholder="H"
            />
          </div>
        </Row>
        <Row label="Font (cm)">
          <Input
            type="number"
            value={text.fontSize ?? 30}
            min={8}
            max={200}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onUpdate({ fontSize: Math.max(8, v) });
            }}
            className="h-8 w-20 text-xs"
          />
        </Row>
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Colour
          </div>
          <ColorPicker
            value={text.color ?? null}
            defaultColor="#0f172a"
            readOnly={readOnly}
            onChange={(c) =>
              onUpdate({ color: c === null ? undefined : c })
            }
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
            Delete text
          </Button>
        )}
      </div>
    </fieldset>
  );
}

function ArrowBody({
  arrow,
  readOnly,
  onUpdate,
  onDelete,
}: {
  arrow: ArrowAnnotation;
  readOnly: boolean;
  onUpdate: (patch: Partial<ArrowAnnotation>) => void;
  onDelete: () => void;
}) {
  return (
    <fieldset disabled={readOnly} className="contents">
      <div className="space-y-3">
        <Row label="Start (m)">
          <div className="grid grid-cols-2 gap-1.5">
            <MetresInput
              valueCm={arrow.x1}
              onChange={(cm) => cm !== null && onUpdate({ x1: cm })}
              placeholder="X"
            />
            <MetresInput
              valueCm={arrow.y1}
              onChange={(cm) => cm !== null && onUpdate({ y1: cm })}
              placeholder="Y"
            />
          </div>
        </Row>
        <Row label="End (m)">
          <div className="grid grid-cols-2 gap-1.5">
            <MetresInput
              valueCm={arrow.x2}
              onChange={(cm) => cm !== null && onUpdate({ x2: cm })}
              placeholder="X"
            />
            <MetresInput
              valueCm={arrow.y2}
              onChange={(cm) => cm !== null && onUpdate({ y2: cm })}
              placeholder="Y"
            />
          </div>
        </Row>
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Colour
          </div>
          <ColorPicker
            value={arrow.color ?? null}
            defaultColor="#0f172a"
            readOnly={readOnly}
            onChange={(c) =>
              onUpdate({ color: c === null ? undefined : c })
            }
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
            Delete arrow
          </Button>
        )}
      </div>
    </fieldset>
  );
}

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

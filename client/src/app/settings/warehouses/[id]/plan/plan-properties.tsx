"use client";

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
import type {
  LocalLocation,
  Room,
  Selection,
  StorageLocationKind,
  Wall,
} from "./plan-types";
import { Info, Trash2 } from "lucide-react";

interface PlanPropertiesProps {
  selection: Selection;
  walls: Wall[];
  rooms: Room[];
  locations: LocalLocation[];
  readOnly: boolean;
  onWallUpdate: (id: string, patch: Partial<Wall>) => void;
  onWallDelete: (id: string) => void;
  onRoomUpdate: (id: string, patch: Partial<Room>) => void;
  onRoomDelete: (id: string) => void;
  onLocationUpdate: (
    id: string | number,
    patch: Partial<Omit<LocalLocation, "id" | "uuid" | "tempId">>,
  ) => void;
  onLocationDelete: (id: string | number) => void;
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
 * Right-side properties panel. Renders a different form per
 * selection kind. Empty state when nothing is selected.
 *
 * Pure presentational — the parent owns state and gets called back
 * for every change so undo/redo + the dirty tracker stay correct.
 */
export function PlanProperties({
  selection,
  walls,
  rooms,
  locations,
  readOnly,
  onWallUpdate,
  onWallDelete,
  onRoomUpdate,
  onRoomDelete,
  onLocationUpdate,
  onLocationDelete,
}: PlanPropertiesProps) {
  if (selection.kind === "none") {
    return (
      <Panel title="No selection">
        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Click any element on the canvas to edit it, or pick a tool
              from the left to draw something new.
            </span>
          </div>
          <ul className="space-y-1 pl-1">
            <li>
              <kbd className="rounded border border-border bg-background px-1 text-[10px]">
                V
              </kbd>{" "}
              select
            </li>
            <li>
              <kbd className="rounded border border-border bg-background px-1 text-[10px]">
                H
              </kbd>{" "}
              pan
            </li>
            <li>
              <kbd className="rounded border border-border bg-background px-1 text-[10px]">
                W
              </kbd>{" "}
              wall ·{" "}
              <kbd className="rounded border border-border bg-background px-1 text-[10px]">
                R
              </kbd>{" "}
              room ·{" "}
              <kbd className="rounded border border-border bg-background px-1 text-[10px]">
                L
              </kbd>{" "}
              location
            </li>
          </ul>
        </div>
      </Panel>
    );
  }

  if (selection.kind === "wall") {
    const wall = walls.find((w) => w.id === selection.id);
    if (!wall) return <Panel title="Wall" />;
    const length = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
    return (
      <Panel title="Wall">
        <fieldset disabled={readOnly} className="contents">
          <div className="space-y-3">
            <Row label="Length">
              <span className="text-xs text-muted-foreground">
                {Math.round(length)} units
              </span>
            </Row>
            <Row label="Start">
              <span className="font-mono text-[11px] text-muted-foreground">
                ({wall.x1}, {wall.y1})
              </span>
            </Row>
            <Row label="End">
              <div className="grid grid-cols-2 gap-1.5">
                <Input
                  type="number"
                  value={wall.x2}
                  onChange={(e) =>
                    onWallUpdate(wall.id, { x2: Number(e.target.value) })
                  }
                  className="h-8 text-xs"
                />
                <Input
                  type="number"
                  value={wall.y2}
                  onChange={(e) =>
                    onWallUpdate(wall.id, { y2: Number(e.target.value) })
                  }
                  className="h-8 text-xs"
                />
              </div>
            </Row>
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onWallDelete(wall.id)}
                className="w-full justify-start text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-1.5 size-3.5" />
                Delete wall
              </Button>
            )}
          </div>
        </fieldset>
      </Panel>
    );
  }

  if (selection.kind === "room") {
    const room = rooms.find((r) => r.id === selection.id);
    if (!room) return <Panel title="Room" />;
    return (
      <Panel title="Room">
        <fieldset disabled={readOnly} className="contents">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="room-label" className="text-xs">
                Label
              </Label>
              <Input
                id="room-label"
                value={room.label ?? ""}
                onChange={(e) =>
                  onRoomUpdate(room.id, { label: e.target.value || undefined })
                }
                placeholder="e.g. Receiving"
                className="h-8 text-xs"
              />
            </div>
            <Row label="Size">
              <div className="grid grid-cols-2 gap-1.5">
                <Input
                  type="number"
                  value={room.width}
                  onChange={(e) =>
                    onRoomUpdate(room.id, { width: Number(e.target.value) })
                  }
                  className="h-8 text-xs"
                  aria-label="Width"
                />
                <Input
                  type="number"
                  value={room.height}
                  onChange={(e) =>
                    onRoomUpdate(room.id, { height: Number(e.target.value) })
                  }
                  className="h-8 text-xs"
                  aria-label="Height"
                />
              </div>
            </Row>
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRoomDelete(room.id)}
                className="w-full justify-start text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-1.5 size-3.5" />
                Delete room
              </Button>
            )}
          </div>
        </fieldset>
      </Panel>
    );
  }

  // location
  const location = locations.find(
    (l) => (l.tempId ?? l.uuid) === selection.id,
  );
  if (!location) return <Panel title="Storage location" />;
  return (
    <Panel title="Storage location">
      <fieldset disabled={readOnly} className="contents">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="loc-name" className="text-xs">
              Name
            </Label>
            <Input
              id="loc-name"
              value={location.name}
              onChange={(e) =>
                onLocationUpdate(location.tempId ?? location.uuid, {
                  name: e.target.value,
                })
              }
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
                  onLocationUpdate(location.tempId ?? location.uuid, {
                    code: e.target.value || null,
                  })
                }
                placeholder="e.g. A-12"
                maxLength={40}
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Kind</Label>
              <Select
                value={location.kind ?? ""}
                onValueChange={(v) =>
                  onLocationUpdate(location.tempId ?? location.uuid, {
                    kind: (v || null) as StorageLocationKind | null,
                  })
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

          <Row label="Canvas size">
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                type="number"
                value={location.width}
                onChange={(e) =>
                  onLocationUpdate(location.tempId ?? location.uuid, {
                    width: Math.max(20, Number(e.target.value)),
                  })
                }
                className="h-8 text-xs"
                aria-label="Width"
              />
              <Input
                type="number"
                value={location.height}
                onChange={(e) =>
                  onLocationUpdate(location.tempId ?? location.uuid, {
                    height: Math.max(20, Number(e.target.value)),
                  })
                }
                className="h-8 text-xs"
                aria-label="Height"
              />
            </div>
          </Row>

          <Row label="Physical (m)">
            <div className="grid grid-cols-3 gap-1.5">
              <Input
                type="number"
                value={location.width_m ?? ""}
                step="0.1"
                placeholder="W"
                onChange={(e) =>
                  onLocationUpdate(location.tempId ?? location.uuid, {
                    width_m: e.target.value || null,
                  })
                }
                className="h-8 text-xs"
                aria-label="Width metres"
              />
              <Input
                type="number"
                value={location.height_m ?? ""}
                step="0.1"
                placeholder="H"
                onChange={(e) =>
                  onLocationUpdate(location.tempId ?? location.uuid, {
                    height_m: e.target.value || null,
                  })
                }
                className="h-8 text-xs"
                aria-label="Height metres"
              />
              <Input
                type="number"
                value={location.depth_m ?? ""}
                step="0.1"
                placeholder="D"
                onChange={(e) =>
                  onLocationUpdate(location.tempId ?? location.uuid, {
                    depth_m: e.target.value || null,
                  })
                }
                className="h-8 text-xs"
                aria-label="Depth metres"
              />
            </div>
          </Row>

          <div className="space-y-1">
            <Label htmlFor="loc-capacity" className="text-xs">
              Capacity
            </Label>
            <Input
              id="loc-capacity"
              value={location.capacity ?? ""}
              onChange={(e) =>
                onLocationUpdate(location.tempId ?? location.uuid, {
                  capacity: e.target.value || null,
                })
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
                onLocationUpdate(location.tempId ?? location.uuid, {
                  notes: e.target.value || null,
                })
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
              onClick={() =>
                onLocationDelete(location.tempId ?? location.uuid)
              }
              className="w-full justify-start text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Delete location
            </Button>
          )}
        </div>
      </fieldset>
    </Panel>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full w-64 shrink-0 flex-col rounded-md border border-border/60 bg-background shadow-sm">
      <div className="border-b border-border/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="flex-1 overflow-y-auto p-3">{children}</div>
    </div>
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

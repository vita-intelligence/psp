"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import { ErrorBanner } from "@/components/forms/error-banner";
import { PlanToolbar } from "./plan-toolbar";
import { PlanProperties } from "./plan-properties";
import { PlanFloorSwitcher } from "./plan-floor-switcher";
import { NewFloorButton } from "../new-floor-button";
import {
  createLocationAction,
  deleteLocationAction,
  updateLocationAction,
} from "@/lib/storage-locations/actions";
import { updateFloorAction } from "@/lib/floors/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type { Floor } from "@/lib/types";
import type { ErrorResult } from "@/lib/errors/server";
import type {
  CanvasJson,
  LocalLocation,
  Room,
  Selection,
  ToolMode,
  Viewport,
  Wall,
} from "./plan-types";
import type { PlanCanvasHandle } from "./plan-canvas";
import { Loader2, Save, Undo2, Redo2 } from "lucide-react";

// react-konva pulls in browser-only globals (window, document). Skip
// SSR to avoid hydration errors; show a tiny placeholder while it
// loads on the client.
const PlanCanvas = dynamic(
  () => import("./plan-canvas").then((m) => m.PlanCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[600px] items-center justify-center rounded-md border border-border/60 bg-muted/30 text-xs text-muted-foreground">
        Loading canvas…
      </div>
    ),
  },
);

interface WarehousePlanEditorProps {
  warehouseUuid: string;
  warehouseId: number;
  warehouseName: string;
  floors: Floor[];
  canEdit: boolean;
}

interface FloorState {
  /** Server-side floor metadata + canvas_json. We never mutate
   *  `meta` after first load; edits live in walls/rooms/locations. */
  meta: Floor;
  walls: Wall[];
  rooms: Room[];
  locations: LocalLocation[];
  viewport: Viewport;
  /** True when canvas_json or any location row has been touched. */
  dirty: boolean;
}

interface HistoryEntry {
  walls: Wall[];
  rooms: Room[];
  locations: LocalLocation[];
}

const HISTORY_LIMIT = 50;

function emptyViewport(): Viewport {
  return { x: 0, y: 0, scale: 1 };
}

function buildFloorState(meta: Floor): FloorState {
  const canvas = (meta.canvas_json ?? {}) as CanvasJson;
  const locations: LocalLocation[] = (meta.storage_locations ?? []).map(
    (l) => ({ ...l, dirty: false, deleted: false }),
  );
  return {
    meta,
    walls: canvas.walls ?? [],
    rooms: canvas.rooms ?? [],
    locations,
    viewport: canvas.viewport ?? emptyViewport(),
    dirty: false,
  };
}

/**
 * The whole plan editor — canvas + toolbar + properties + save flow.
 *
 * State model:
 *   • `floorStates` keys by floor.id and holds the LOCAL working
 *     copy of every floor's walls/rooms/locations + viewport + dirty
 *     flag. Switching floors doesn't drop unsaved work.
 *   • `activeFloorId` picks which one the canvas renders.
 *   • `history` / `redoStack` per active floor for ctrl+Z / ctrl+Y.
 *   • `selection` is per-floor too — switching clears selection.
 *
 * Save flow:
 *   • On click Save we PUT the floor (canvas_json), then for each
 *     local location we POST new ones / PUT dirty ones / DELETE
 *     marked-deleted ones, all in parallel where order is safe.
 *   • Audit invalidator fires after the floor PUT so the Activity
 *     timeline picks up the new event without a refresh.
 *
 * Realtime collab arrives in phase 5 — for now this is single-user.
 */
export function WarehousePlanEditor({
  warehouseUuid,
  warehouseId,
  warehouseName,
  floors,
  canEdit,
}: WarehousePlanEditorProps) {
  const router = useRouter();
  const canvasRef = useRef<PlanCanvasHandle | null>(null);
  const readOnly = !canEdit;

  // Build initial per-floor state from props. We never re-derive
  // from props after first mount — the user's local edits are the
  // source of truth until Save (or Discard).
  const [floorStates, setFloorStates] = useState<Record<number, FloorState>>(
    () => Object.fromEntries(floors.map((f) => [f.id, buildFloorState(f)])),
  );

  const [activeFloorId, setActiveFloorId] = useState<number | null>(
    floors[0]?.id ?? null,
  );
  const [tool, setTool] = useState<ToolMode>("select");
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  // Per-floor undo/redo stacks. The active floor's stack is read &
  // written; switching floors keeps the other stacks intact.
  const [history, setHistory] = useState<Record<number, HistoryEntry[]>>({});
  const [redoStack, setRedoStack] = useState<Record<number, HistoryEntry[]>>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [saving, startSaving] = useTransition();

  // Re-build state when the floors prop changes (e.g. a new floor
  // was added via the bottom switcher's button). Preserve any local
  // dirty edits the user already had — only seed brand-new floors.
  useEffect(() => {
    setFloorStates((prev) => {
      const next = { ...prev };
      for (const f of floors) {
        if (!(f.id in next)) {
          next[f.id] = buildFloorState(f);
        }
      }
      return next;
    });
    if (activeFloorId === null && floors.length > 0) {
      setActiveFloorId(floors[0]!.id);
    }
  }, [floors, activeFloorId]);

  const activeFloor = activeFloorId != null ? floorStates[activeFloorId] : null;

  const anyDirty = Object.values(floorStates).some((s) => s.dirty);

  // -------------------------------------------------------------- helpers

  const pushHistory = useCallback(
    (floorId: number, state: FloorState) => {
      setHistory((prev) => {
        const stack = prev[floorId] ?? [];
        const entry: HistoryEntry = {
          walls: state.walls,
          rooms: state.rooms,
          locations: state.locations,
        };
        const next = [...stack, entry].slice(-HISTORY_LIMIT);
        return { ...prev, [floorId]: next };
      });
      // Any new edit invalidates the redo stack.
      setRedoStack((prev) => ({ ...prev, [floorId]: [] }));
    },
    [],
  );

  const updateActiveFloor = useCallback(
    (mutator: (prev: FloorState) => FloorState, options?: { snapshot?: boolean }) => {
      if (activeFloorId == null) return;
      setFloorStates((prev) => {
        const current = prev[activeFloorId];
        if (!current) return prev;
        if (options?.snapshot) pushHistory(activeFloorId, current);
        const next = mutator(current);
        return { ...prev, [activeFloorId]: { ...next, dirty: true } };
      });
    },
    [activeFloorId, pushHistory],
  );

  // -------------------------------------------------------------- callbacks

  const onWallAdded = useCallback(
    (wall: Wall) => {
      updateActiveFloor(
        (s) => ({ ...s, walls: [...s.walls, wall] }),
        { snapshot: true },
      );
      setTool("select");
      setSelection({ kind: "wall", id: wall.id });
    },
    [updateActiveFloor],
  );

  const onRoomAdded = useCallback(
    (room: Room) => {
      updateActiveFloor(
        (s) => ({ ...s, rooms: [...s.rooms, room] }),
        { snapshot: true },
      );
      setTool("select");
      setSelection({ kind: "room", id: room.id });
    },
    [updateActiveFloor],
  );

  const onLocationAdded = useCallback(
    (geom: { x: number; y: number; width: number; height: number }) => {
      const tempId = `tmp_${crypto.randomUUID()}`;
      updateActiveFloor(
        (s) => {
          const count = s.locations.filter((l) => !l.deleted).length;
          const newLoc: LocalLocation = {
            id: -1,
            uuid: tempId,
            warehouse_id: warehouseId,
            floor_id: s.meta.id,
            name: `Location ${count + 1}`,
            code: null,
            kind: "rack",
            x: geom.x,
            y: geom.y,
            width: geom.width,
            height: geom.height,
            width_m: null,
            height_m: null,
            depth_m: null,
            capacity: null,
            notes: null,
            inserted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            tempId,
            dirty: true,
            deleted: false,
          };
          return { ...s, locations: [...s.locations, newLoc] };
        },
        { snapshot: true },
      );
      setTool("select");
      setSelection({ kind: "location", id: tempId });
    },
    [updateActiveFloor, warehouseId],
  );

  const onLocationMove = useCallback(
    (id: string | number, x: number, y: number) => {
      updateActiveFloor(
        (s) => ({
          ...s,
          locations: s.locations.map((l) =>
            (l.tempId ?? l.uuid) === id
              ? { ...l, x, y, dirty: true }
              : l,
          ),
        }),
        { snapshot: true },
      );
    },
    [updateActiveFloor],
  );

  const onRoomMove = useCallback(
    (id: string, x: number, y: number) => {
      updateActiveFloor(
        (s) => ({
          ...s,
          rooms: s.rooms.map((r) => (r.id === id ? { ...r, x, y } : r)),
        }),
        { snapshot: true },
      );
    },
    [updateActiveFloor],
  );

  const onWallUpdate = useCallback(
    (id: string, patch: Partial<Wall>) => {
      updateActiveFloor((s) => ({
        ...s,
        walls: s.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      }));
    },
    [updateActiveFloor],
  );

  const onWallDelete = useCallback(
    (id: string) => {
      updateActiveFloor(
        (s) => ({ ...s, walls: s.walls.filter((w) => w.id !== id) }),
        { snapshot: true },
      );
      setSelection({ kind: "none" });
    },
    [updateActiveFloor],
  );

  const onRoomUpdate = useCallback(
    (id: string, patch: Partial<Room>) => {
      updateActiveFloor((s) => ({
        ...s,
        rooms: s.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      }));
    },
    [updateActiveFloor],
  );

  const onRoomDelete = useCallback(
    (id: string) => {
      updateActiveFloor(
        (s) => ({ ...s, rooms: s.rooms.filter((r) => r.id !== id) }),
        { snapshot: true },
      );
      setSelection({ kind: "none" });
    },
    [updateActiveFloor],
  );

  const onLocationUpdate = useCallback(
    (
      id: string | number,
      patch: Partial<Omit<LocalLocation, "id" | "uuid" | "tempId">>,
    ) => {
      updateActiveFloor((s) => ({
        ...s,
        locations: s.locations.map((l) =>
          (l.tempId ?? l.uuid) === id
            ? { ...l, ...patch, dirty: true }
            : l,
        ),
      }));
    },
    [updateActiveFloor],
  );

  const onLocationDelete = useCallback(
    (id: string | number) => {
      updateActiveFloor(
        (s) => ({
          ...s,
          locations: s.locations.map((l) =>
            (l.tempId ?? l.uuid) === id
              ? // New (unsaved) locations are removed outright;
                // existing rows get marked-deleted so save can DELETE
                // them.
                l.tempId
                ? { ...l, deleted: true }
                : { ...l, deleted: true, dirty: true }
              : l,
          ),
        }),
        { snapshot: true },
      );
      setSelection({ kind: "none" });
    },
    [updateActiveFloor],
  );

  const onViewportChange = useCallback(
    (next: Viewport) => {
      // Viewport changes aren't snapshot — they're not really "edits"
      // worth undo/redo, just camera. They DO mark dirty so the
      // saved canvas_json carries the user's last view.
      updateActiveFloor((s) => ({ ...s, viewport: next }));
    },
    [updateActiveFloor],
  );

  // ----------------------------------------------------------- undo/redo

  const undo = useCallback(() => {
    if (activeFloorId == null) return;
    const stack = history[activeFloorId] ?? [];
    if (stack.length === 0) return;
    const last = stack[stack.length - 1]!;
    setFloorStates((prev) => {
      const current = prev[activeFloorId];
      if (!current) return prev;
      setRedoStack((r) => ({
        ...r,
        [activeFloorId]: [
          ...(r[activeFloorId] ?? []),
          {
            walls: current.walls,
            rooms: current.rooms,
            locations: current.locations,
          },
        ],
      }));
      return {
        ...prev,
        [activeFloorId]: {
          ...current,
          walls: last.walls,
          rooms: last.rooms,
          locations: last.locations,
          dirty: true,
        },
      };
    });
    setHistory((prev) => ({
      ...prev,
      [activeFloorId]: stack.slice(0, -1),
    }));
    setSelection({ kind: "none" });
  }, [activeFloorId, history]);

  const redo = useCallback(() => {
    if (activeFloorId == null) return;
    const stack = redoStack[activeFloorId] ?? [];
    if (stack.length === 0) return;
    const last = stack[stack.length - 1]!;
    setFloorStates((prev) => {
      const current = prev[activeFloorId];
      if (!current) return prev;
      setHistory((h) => ({
        ...h,
        [activeFloorId]: [
          ...(h[activeFloorId] ?? []),
          {
            walls: current.walls,
            rooms: current.rooms,
            locations: current.locations,
          },
        ],
      }));
      return {
        ...prev,
        [activeFloorId]: {
          ...current,
          walls: last.walls,
          rooms: last.rooms,
          locations: last.locations,
          dirty: true,
        },
      };
    });
    setRedoStack((prev) => ({
      ...prev,
      [activeFloorId]: stack.slice(0, -1),
    }));
    setSelection({ kind: "none" });
  }, [activeFloorId, redoStack]);

  // ----------------------------------------------------------- shortcuts

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // Skip when typing in a form field.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (readOnly) return;
      const k = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;

      if (mod && k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((mod && k === "z" && e.shiftKey) || (mod && k === "y")) {
        e.preventDefault();
        redo();
        return;
      }
      switch (k) {
        case "v":
          setTool("select");
          break;
        case "h":
          setTool("pan");
          break;
        case "w":
          setTool("wall");
          break;
        case "r":
          setTool("room");
          break;
        case "l":
          setTool("location");
          break;
        case "escape":
          setSelection({ kind: "none" });
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, readOnly]);

  // ----------------------------------------------------------- save flow

  const canvasJsonFor = useCallback((s: FloorState): CanvasJson => {
    return {
      viewport: s.viewport,
      walls: s.walls,
      rooms: s.rooms,
    };
  }, []);

  const onSave = useCallback(() => {
    if (!activeFloor) return;
    setActionError(null);

    startSaving(async () => {
      const state = activeFloor;
      // 1. Update the floor's canvas_json
      const floorRes = await updateFloorAction(
        warehouseUuid,
        state.meta.uuid,
        { canvas_json: canvasJsonFor(state) as unknown as Record<string, unknown> },
      );

      if (!floorRes.ok) {
        setActionError(floorRes);
        return;
      }

      // 2. Process locations
      // New (tempId, not deleted): POST
      // Existing dirty (no tempId, dirty, not deleted): PUT
      // Existing marked-deleted (no tempId, deleted): DELETE
      // Unsaved-and-deleted (tempId, deleted): skip (only existed locally)

      const newRows = state.locations.filter((l) => l.tempId && !l.deleted);
      const dirtyRows = state.locations.filter(
        (l) => !l.tempId && l.dirty && !l.deleted,
      );
      const deletedRows = state.locations.filter((l) => !l.tempId && l.deleted);

      const tempIdToServerId = new Map<string, { id: number; uuid: string }>();

      // Run creates sequentially so audit events stay ordered + we
      // collect their ids. They're cheap (small payloads); parallel
      // not worth the complexity.
      for (const loc of newRows) {
        const res = await createLocationAction(warehouseUuid, {
          floor_uuid: state.meta.uuid,
          name: loc.name,
          code: loc.code,
          kind: loc.kind,
          x: loc.x,
          y: loc.y,
          width: loc.width,
          height: loc.height,
          width_m: loc.width_m,
          height_m: loc.height_m,
          depth_m: loc.depth_m,
          capacity: loc.capacity,
          notes: loc.notes,
        });
        if (!res.ok) {
          setActionError(res);
          return;
        }
        if (loc.tempId) {
          tempIdToServerId.set(loc.tempId, {
            id: res.storage_location.id,
            uuid: res.storage_location.uuid,
          });
        }
      }

      // Updates + deletes can run in parallel — they affect distinct
      // rows.
      const opResults = await Promise.all([
        ...dirtyRows.map((loc) =>
          updateLocationAction(warehouseUuid, loc.uuid, {
            name: loc.name,
            code: loc.code,
            kind: loc.kind,
            x: loc.x,
            y: loc.y,
            width: loc.width,
            height: loc.height,
            width_m: loc.width_m,
            height_m: loc.height_m,
            depth_m: loc.depth_m,
            capacity: loc.capacity,
            notes: loc.notes,
          }),
        ),
        ...deletedRows.map((loc) =>
          deleteLocationAction(warehouseUuid, loc.uuid),
        ),
      ]);

      const firstFailure = opResults.find((r) => !r.ok);
      if (firstFailure && !firstFailure.ok) {
        setActionError(firstFailure);
        return;
      }

      // Reconcile local state with server: replace tempIds with real
      // uuids, drop marked-deleted rows, clear dirty flags.
      setFloorStates((prev) => {
        const current = prev[state.meta.id];
        if (!current) return prev;
        const merged: LocalLocation[] = current.locations
          .filter((l) => !(l.deleted && !l.tempId === false)) // drop already-applied deletes below
          .filter((l) => !l.deleted)
          .map((l) => {
            if (l.tempId) {
              const remote = tempIdToServerId.get(l.tempId);
              if (remote) {
                return {
                  ...l,
                  id: remote.id,
                  uuid: remote.uuid,
                  tempId: undefined,
                  dirty: false,
                };
              }
              return { ...l, dirty: false };
            }
            return { ...l, dirty: false };
          });
        return {
          ...prev,
          [state.meta.id]: {
            ...current,
            meta: floorRes.floor,
            locations: merged,
            dirty: false,
          },
        };
      });

      // Tell the Activity card to refetch + push the freshest server
      // state into the page.
      invalidateAudit("warehouse", warehouseId);
      router.refresh();
      toast.success("Plan saved", {
        description: `Saved "${state.meta.name}".`,
      });
    });
  }, [
    activeFloor,
    canvasJsonFor,
    router,
    warehouseId,
    warehouseUuid,
  ]);

  const onDiscard = useCallback(() => {
    if (!activeFloor) return;
    // Rebuild from the floor.meta we have on hand. If the user wants
    // a true "discard back to server state", they can refresh.
    const reset = buildFloorState(activeFloor.meta);
    setFloorStates((prev) => ({ ...prev, [activeFloor.meta.id]: reset }));
    setHistory((prev) => ({ ...prev, [activeFloor.meta.id]: [] }));
    setRedoStack((prev) => ({ ...prev, [activeFloor.meta.id]: [] }));
    setSelection({ kind: "none" });
    setActionError(null);
  }, [activeFloor]);

  // ----------------------------------------------------------- render

  if (floors.length === 0) {
    return null; // PlanTab handles the empty state with NewFloorButton
  }

  const undoCount = activeFloorId != null ? (history[activeFloorId] ?? []).length : 0;
  const redoCount = activeFloorId != null ? (redoStack[activeFloorId] ?? []).length : 0;

  return (
    <div className="space-y-3">
      {/* Toolbar row: save state + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={activeFloor?.dirty ? "amber" : "muted"}>
          {activeFloor?.dirty ? "Unsaved changes" : "Saved"}
        </Badge>
        <p className="text-xs text-muted-foreground">
          Editing{" "}
          <span className="font-medium text-foreground">{warehouseName}</span>
          {activeFloor && (
            <>
              {" · "}
              <span className="font-medium text-foreground">
                {activeFloor.meta.name}
              </span>
            </>
          )}
        </p>

        <div className="ml-auto flex items-center gap-1">
          {!readOnly && (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={undo}
                disabled={undoCount === 0 || saving}
                title="Undo (Ctrl/Cmd Z)"
              >
                <Undo2 className="size-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={redo}
                disabled={redoCount === 0 || saving}
                title="Redo (Ctrl/Cmd Shift Z)"
              >
                <Redo2 className="size-4" />
              </Button>
              {activeFloor?.dirty && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={onDiscard}
                  disabled={saving}
                >
                  Discard
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={onSave}
                disabled={!anyDirty || saving}
              >
                {saving ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 size-4" />
                )}
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      {actionError && (
        <ErrorBanner
          detail={actionError.detail}
          code={actionError.code}
          debug={actionError.debug}
        />
      )}

      {/* Main editor — toolbar + canvas + properties */}
      <div className="flex gap-3">
        <PlanToolbar
          tool={tool}
          onToolChange={(t) => setTool(t)}
          onZoomIn={() => canvasRef.current?.zoomIn()}
          onZoomOut={() => canvasRef.current?.zoomOut()}
          onResetView={() => canvasRef.current?.resetView()}
          disabled={!activeFloor || readOnly}
        />

        <div className="min-w-0 flex-1">
          {activeFloor ? (
            <PlanCanvas
              ref={canvasRef}
              walls={activeFloor.walls}
              rooms={activeFloor.rooms}
              locations={activeFloor.locations}
              selection={selection}
              tool={tool}
              viewport={activeFloor.viewport}
              readOnly={readOnly}
              onSelectionChange={setSelection}
              onViewportChange={onViewportChange}
              onWallAdded={onWallAdded}
              onRoomAdded={onRoomAdded}
              onLocationAdded={onLocationAdded}
              onLocationMove={onLocationMove}
              onRoomMove={onRoomMove}
            />
          ) : (
            <div className="flex h-[600px] items-center justify-center rounded-md border border-border/60 bg-muted/30 text-sm text-muted-foreground">
              Select a floor below to start editing.
            </div>
          )}
        </div>

        <PlanProperties
          selection={selection}
          walls={activeFloor?.walls ?? []}
          rooms={activeFloor?.rooms ?? []}
          locations={activeFloor?.locations ?? []}
          readOnly={readOnly}
          onWallUpdate={onWallUpdate}
          onWallDelete={onWallDelete}
          onRoomUpdate={onRoomUpdate}
          onRoomDelete={onRoomDelete}
          onLocationUpdate={onLocationUpdate}
          onLocationDelete={onLocationDelete}
        />
      </div>

      {/* Floor switcher + add */}
      <div className="flex items-center gap-2">
        <PlanFloorSwitcher
          floors={floors}
          activeFloorId={activeFloorId}
          onSelect={(id) => {
            setActiveFloorId(id);
            setSelection({ kind: "none" });
          }}
          // The switcher's own "Add floor" button is suppressed here —
          // the sibling <NewFloorButton> below opens a richer dialog
          // (named input, validation, etc.).
          onAddFloor={() => undefined}
          canAdd={false}
          hasUnsavedChanges={activeFloor?.dirty}
        />
        {canEdit && (
          <NewFloorButton
            warehouseUuid={warehouseUuid}
            suggestedName={`Floor ${floors.length + 1}`}
          />
        )}
      </div>
    </div>
  );
}

"use client";

import {
  useCallback,
  useEffect,
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
import { cn } from "@/lib/utils";
import type {
  CanvasJson,
  FloorOutline,
  Hole,
  LocalLocation,
  Point,
  Selection,
  ToolMode,
  Viewport,
  Wall,
} from "./plan-types";
import type { PlanCanvasHandle } from "./plan-canvas";
import {
  ChevronDown,
  Loader2,
  Redo2,
  Save,
  Undo2,
  X,
} from "lucide-react";

// react-konva touches window / document on import — skip SSR.
const PlanCanvas = dynamic(
  () => import("./plan-canvas").then((m) => m.PlanCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[480px] items-center justify-center rounded-md border border-border/60 bg-muted/30 text-xs text-muted-foreground">
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
   *  `meta` after first load; edits live in outline/walls/locations. */
  meta: Floor;
  outline: FloorOutline | undefined;
  walls: Wall[];
  locations: LocalLocation[];
  viewport: Viewport;
  /** True when canvas_json or any location row has been touched. */
  dirty: boolean;
}

interface HistoryEntry {
  outline: FloorOutline | undefined;
  walls: Wall[];
  locations: LocalLocation[];
}

const HISTORY_LIMIT = 50;
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 0.4 };

function buildFloorState(meta: Floor): FloorState {
  const canvas = (meta.canvas_json ?? {}) as CanvasJson;
  const locations: LocalLocation[] = (meta.storage_locations ?? []).map(
    (l) => ({ ...l, dirty: false, deleted: false }),
  );
  return {
    meta,
    outline: canvas.outline,
    walls: canvas.walls ?? [],
    locations,
    viewport: canvas.viewport ?? DEFAULT_VIEWPORT,
    dirty: false,
  };
}

function useIsMobile(): boolean {
  // 768px = Tailwind's md breakpoint. Below that we switch the
  // editor into mobile layout: horizontal toolbar at the bottom,
  // bottom sheet for properties.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);
  return isMobile;
}

/**
 * The plan editor shell — canvas + toolbar + properties + save flow.
 *
 * Layout adapts:
 *   • md+ (desktop): three-column flexbox — toolbar | canvas | props
 *   • <md (mobile):  canvas + horizontal toolbar underneath + a
 *                    bottom-sheet that slides in when selection !=
 *                    none. Two-finger pan/zoom, tap to select.
 *
 * State model:
 *   • `floorStates` keys by floor.id and holds the local working
 *     copy of every floor's outline / walls / locations + viewport
 *     + dirty flag. Switching floors doesn't drop unsaved work.
 *   • Per-floor undo / redo stacks (50 entries each). Ctrl/Cmd+Z and
 *     Ctrl/Cmd+Y bound globally (skipped when typing).
 *
 * Save flow:
 *   • PUT the floor (canvas_json: outline + walls + viewport).
 *   • POST new locations / PUT dirty ones / DELETE marked-deleted.
 *   • Audit invalidator fires so the Activity card refreshes.
 *   • Local tempIds get reconciled to server uuids on success.
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
  const isMobile = useIsMobile();

  const [floorStates, setFloorStates] = useState<Record<number, FloorState>>(
    () => Object.fromEntries(floors.map((f) => [f.id, buildFloorState(f)])),
  );

  const [activeFloorId, setActiveFloorId] = useState<number | null>(
    floors[0]?.id ?? null,
  );
  const [tool, setTool] = useState<ToolMode>("select");
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [history, setHistory] = useState<Record<number, HistoryEntry[]>>({});
  const [redoStack, setRedoStack] = useState<Record<number, HistoryEntry[]>>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [saving, startSaving] = useTransition();
  // Mobile-only: the properties sheet is collapsed by default and
  // opens when selection becomes non-none.
  const [propsSheetOpen, setPropsSheetOpen] = useState(false);

  // Open the mobile sheet automatically when something is selected;
  // close it when selection clears.
  useEffect(() => {
    if (!isMobile) return;
    setPropsSheetOpen(selection.kind !== "none");
  }, [isMobile, selection.kind]);

  // Seed brand-new floors that arrived via the bottom switcher's
  // "Add floor" button. Preserve any local dirty edits on others.
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

  const pushHistory = useCallback((floorId: number, state: FloorState) => {
    setHistory((prev) => {
      const stack = prev[floorId] ?? [];
      const entry: HistoryEntry = {
        outline: state.outline,
        walls: state.walls,
        locations: state.locations,
      };
      const next = [...stack, entry].slice(-HISTORY_LIMIT);
      return { ...prev, [floorId]: next };
    });
    setRedoStack((prev) => ({ ...prev, [floorId]: [] }));
  }, []);

  const updateActiveFloor = useCallback(
    (
      mutator: (prev: FloorState) => FloorState,
      options?: { snapshot?: boolean },
    ) => {
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
            (l.tempId ?? l.uuid) === id ? { ...l, x, y, dirty: true } : l,
          ),
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
              ? l.tempId
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
      // Viewport changes mark dirty (so they save) but don't snapshot
      // for undo — camera moves shouldn't fill the history.
      updateActiveFloor((s) => ({ ...s, viewport: next }));
    },
    [updateActiveFloor],
  );

  const onOutlineCommitted = useCallback(
    (points: Point[]) => {
      updateActiveFloor(
        (s) => ({
          ...s,
          // Replace outline entirely on commit. Holes are dropped —
          // they were tied to the previous perimeter. Same model as
          // most CAD tools.
          outline: { points, holes: [] },
        }),
        { snapshot: true },
      );
      setTool("select");
      setSelection({ kind: "outline" });
    },
    [updateActiveFloor],
  );

  const onHoleCommitted = useCallback(
    (points: Point[]) => {
      const holeId = crypto.randomUUID();
      updateActiveFloor(
        (s) => {
          if (!s.outline) return s;
          const newHole: Hole = { id: holeId, points };
          return {
            ...s,
            outline: {
              ...s.outline,
              holes: [...(s.outline.holes ?? []), newHole],
            },
          };
        },
        { snapshot: true },
      );
      setTool("select");
      setSelection({ kind: "hole", id: holeId });
    },
    [updateActiveFloor],
  );

  const onOutlineDelete = useCallback(() => {
    updateActiveFloor(
      (s) => ({ ...s, outline: undefined }),
      { snapshot: true },
    );
    setSelection({ kind: "none" });
  }, [updateActiveFloor]);

  const onHoleUpdate = useCallback(
    (id: string, patch: Partial<Hole>) => {
      updateActiveFloor((s) => {
        if (!s.outline) return s;
        return {
          ...s,
          outline: {
            ...s.outline,
            holes: (s.outline.holes ?? []).map((h) =>
              h.id === id ? { ...h, ...patch } : h,
            ),
          },
        };
      });
    },
    [updateActiveFloor],
  );

  const onHoleDelete = useCallback(
    (id: string) => {
      updateActiveFloor(
        (s) => {
          if (!s.outline) return s;
          return {
            ...s,
            outline: {
              ...s.outline,
              holes: (s.outline.holes ?? []).filter((h) => h.id !== id),
            },
          };
        },
        { snapshot: true },
      );
      setSelection({ kind: "none" });
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
            outline: current.outline,
            walls: current.walls,
            locations: current.locations,
          },
        ],
      }));
      return {
        ...prev,
        [activeFloorId]: {
          ...current,
          outline: last.outline,
          walls: last.walls,
          locations: last.locations,
          dirty: true,
        },
      };
    });
    setHistory((prev) => ({ ...prev, [activeFloorId]: stack.slice(0, -1) }));
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
            outline: current.outline,
            walls: current.walls,
            locations: current.locations,
          },
        ],
      }));
      return {
        ...prev,
        [activeFloorId]: {
          ...current,
          outline: last.outline,
          walls: last.walls,
          locations: last.locations,
          dirty: true,
        },
      };
    });
    setRedoStack((prev) => ({ ...prev, [activeFloorId]: stack.slice(0, -1) }));
    setSelection({ kind: "none" });
  }, [activeFloorId, redoStack]);

  // ----------------------------------------------------------- shortcuts

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
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
        case "f":
          setTool("outline");
          break;
        case "o":
          if (activeFloor?.outline) setTool("hole");
          break;
        case "l":
          setTool("location");
          break;
        case "escape":
          canvasRef.current?.cancelDraft();
          setSelection({ kind: "none" });
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, readOnly, activeFloor?.outline]);

  // ----------------------------------------------------------- save flow

  const canvasJsonFor = useCallback((s: FloorState): CanvasJson => {
    return {
      viewport: s.viewport,
      outline: s.outline,
      walls: s.walls,
    };
  }, []);

  const onSave = useCallback(() => {
    if (!activeFloor) return;
    setActionError(null);

    startSaving(async () => {
      const state = activeFloor;
      const floorRes = await updateFloorAction(warehouseUuid, state.meta.uuid, {
        canvas_json: canvasJsonFor(state) as unknown as Record<string, unknown>,
      });

      if (!floorRes.ok) {
        setActionError(floorRes);
        return;
      }

      const newRows = state.locations.filter((l) => l.tempId && !l.deleted);
      const dirtyRows = state.locations.filter(
        (l) => !l.tempId && l.dirty && !l.deleted,
      );
      const deletedRows = state.locations.filter((l) => !l.tempId && l.deleted);

      const tempIdToServerId = new Map<string, { id: number; uuid: string }>();

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

      setFloorStates((prev) => {
        const current = prev[state.meta.id];
        if (!current) return prev;
        const merged: LocalLocation[] = current.locations
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

      invalidateAudit("warehouse", warehouseId);
      router.refresh();
      toast.success("Plan saved", {
        description: `Saved "${state.meta.name}".`,
      });
    });
  }, [activeFloor, canvasJsonFor, router, warehouseId, warehouseUuid]);

  const onDiscard = useCallback(() => {
    if (!activeFloor) return;
    const reset = buildFloorState(activeFloor.meta);
    setFloorStates((prev) => ({ ...prev, [activeFloor.meta.id]: reset }));
    setHistory((prev) => ({ ...prev, [activeFloor.meta.id]: [] }));
    setRedoStack((prev) => ({ ...prev, [activeFloor.meta.id]: [] }));
    setSelection({ kind: "none" });
    setActionError(null);
  }, [activeFloor]);

  // ----------------------------------------------------------- render

  if (floors.length === 0) {
    return null; // parent handles the empty state with NewFloorButton
  }

  const undoCount =
    activeFloorId != null ? (history[activeFloorId] ?? []).length : 0;
  const redoCount =
    activeFloorId != null ? (redoStack[activeFloorId] ?? []).length : 0;

  const canvasHeight = isMobile
    ? Math.max(360, typeof window === "undefined" ? 480 : window.innerHeight - 320)
    : 600;

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={activeFloor?.dirty ? "amber" : "muted"}>
          {activeFloor?.dirty ? "Unsaved changes" : "Saved"}
        </Badge>
        <p className="hidden text-xs text-muted-foreground sm:block">
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
                aria-label="Undo"
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
                aria-label="Redo"
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

      {/* Editor body — layout swaps at md */}
      {isMobile ? (
        <MobileLayout
          activeFloor={activeFloor}
          canvasRef={canvasRef}
          tool={tool}
          setTool={setTool}
          selection={selection}
          setSelection={setSelection}
          canvasHeight={canvasHeight}
          readOnly={readOnly}
          onViewportChange={onViewportChange}
          onWallAdded={onWallAdded}
          onLocationAdded={onLocationAdded}
          onLocationMove={onLocationMove}
          onOutlineCommitted={onOutlineCommitted}
          onHoleCommitted={onHoleCommitted}
          onWallUpdate={onWallUpdate}
          onWallDelete={onWallDelete}
          onOutlineDelete={onOutlineDelete}
          onHoleUpdate={onHoleUpdate}
          onHoleDelete={onHoleDelete}
          onLocationUpdate={onLocationUpdate}
          onLocationDelete={onLocationDelete}
          propsSheetOpen={propsSheetOpen}
          setPropsSheetOpen={setPropsSheetOpen}
        />
      ) : (
        <div className="flex gap-3">
          <PlanToolbar
            tool={tool}
            onToolChange={setTool}
            onZoomIn={() => canvasRef.current?.zoomIn()}
            onZoomOut={() => canvasRef.current?.zoomOut()}
            onResetView={() => canvasRef.current?.resetView()}
            hasOutline={!!activeFloor?.outline}
            disabled={!activeFloor || readOnly}
            layout="vertical"
          />

          <div className="min-w-0 flex-1">
            {activeFloor ? (
              <PlanCanvas
                ref={canvasRef}
                outline={activeFloor.outline}
                walls={activeFloor.walls}
                locations={activeFloor.locations}
                selection={selection}
                tool={tool}
                viewport={activeFloor.viewport}
                readOnly={readOnly}
                heightPx={canvasHeight}
                onSelectionChange={setSelection}
                onViewportChange={onViewportChange}
                onWallAdded={onWallAdded}
                onLocationAdded={onLocationAdded}
                onLocationMove={onLocationMove}
                onOutlineCommitted={onOutlineCommitted}
                onHoleCommitted={onHoleCommitted}
              />
            ) : (
              <div className="flex h-[600px] items-center justify-center rounded-md border border-border/60 bg-muted/30 text-sm text-muted-foreground">
                Select a floor below to start editing.
              </div>
            )}
          </div>

          <PlanProperties
            selection={selection}
            outline={activeFloor?.outline}
            walls={activeFloor?.walls ?? []}
            locations={activeFloor?.locations ?? []}
            readOnly={readOnly}
            layout="side"
            onWallUpdate={onWallUpdate}
            onWallDelete={onWallDelete}
            onOutlineDelete={onOutlineDelete}
            onHoleUpdate={onHoleUpdate}
            onHoleDelete={onHoleDelete}
            onLocationUpdate={onLocationUpdate}
            onLocationDelete={onLocationDelete}
          />
        </div>
      )}

      {/* Floor switcher */}
      <div className="flex flex-wrap items-center gap-2">
        <PlanFloorSwitcher
          floors={floors}
          activeFloorId={activeFloorId}
          onSelect={(id) => {
            setActiveFloorId(id);
            setSelection({ kind: "none" });
          }}
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

// ---------------------------------------------------------------- mobile

interface MobileLayoutProps {
  activeFloor: FloorState | null;
  canvasRef: React.MutableRefObject<PlanCanvasHandle | null>;
  tool: ToolMode;
  setTool: (t: ToolMode) => void;
  selection: Selection;
  setSelection: (s: Selection) => void;
  canvasHeight: number;
  readOnly: boolean;
  onViewportChange: (v: Viewport) => void;
  onWallAdded: (w: Wall) => void;
  onLocationAdded: (g: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onLocationMove: (id: string | number, x: number, y: number) => void;
  onOutlineCommitted: (points: Point[]) => void;
  onHoleCommitted: (points: Point[]) => void;
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
  propsSheetOpen: boolean;
  setPropsSheetOpen: (open: boolean) => void;
}

/**
 * Mobile layout: canvas takes most of the viewport; toolbar pinned
 * below; properties slide up as a bottom sheet on selection.
 */
function MobileLayout({
  activeFloor,
  canvasRef,
  tool,
  setTool,
  selection,
  setSelection,
  canvasHeight,
  readOnly,
  onViewportChange,
  onWallAdded,
  onLocationAdded,
  onLocationMove,
  onOutlineCommitted,
  onHoleCommitted,
  onWallUpdate,
  onWallDelete,
  onOutlineDelete,
  onHoleUpdate,
  onHoleDelete,
  onLocationUpdate,
  onLocationDelete,
  propsSheetOpen,
  setPropsSheetOpen,
}: MobileLayoutProps) {
  return (
    <div className="relative">
      <div>
        {activeFloor ? (
          <PlanCanvas
            ref={canvasRef}
            outline={activeFloor.outline}
            walls={activeFloor.walls}
            locations={activeFloor.locations}
            selection={selection}
            tool={tool}
            viewport={activeFloor.viewport}
            readOnly={readOnly}
            heightPx={canvasHeight}
            onSelectionChange={setSelection}
            onViewportChange={onViewportChange}
            onWallAdded={onWallAdded}
            onLocationAdded={onLocationAdded}
            onLocationMove={onLocationMove}
            onOutlineCommitted={onOutlineCommitted}
            onHoleCommitted={onHoleCommitted}
          />
        ) : (
          <div
            style={{ height: canvasHeight }}
            className="flex items-center justify-center rounded-md border border-border/60 bg-muted/30 text-sm text-muted-foreground"
          >
            Pick a floor below to start.
          </div>
        )}
      </div>

      <div className="mt-2">
        <PlanToolbar
          tool={tool}
          onToolChange={setTool}
          onZoomIn={() => canvasRef.current?.zoomIn()}
          onZoomOut={() => canvasRef.current?.zoomOut()}
          onResetView={() => canvasRef.current?.resetView()}
          hasOutline={!!activeFloor?.outline}
          disabled={!activeFloor || readOnly}
          layout="horizontal"
        />
      </div>

      {/* Bottom-sheet properties. Slides up from below the canvas
          when selection != none. Tap the backdrop or X to close. */}
      {propsSheetOpen && selection.kind !== "none" && activeFloor && (
        <div
          className={cn(
            "fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto",
            "rounded-t-xl border-t border-border bg-background shadow-2xl",
            "animate-in slide-in-from-bottom duration-200",
          )}
        >
          <div className="sticky top-0 flex items-center justify-between border-b border-border/60 bg-background px-4 py-2.5">
            <p className="text-sm font-semibold">
              {selection.kind === "outline"
                ? "Floor outline"
                : selection.kind === "hole"
                  ? "Floor cutout"
                  : selection.kind === "wall"
                    ? "Wall"
                    : "Storage location"}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                setPropsSheetOpen(false);
                setSelection({ kind: "none" });
              }}
              aria-label="Close"
              className="size-8"
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="px-4 py-3">
            <PlanProperties
              selection={selection}
              outline={activeFloor.outline}
              walls={activeFloor.walls}
              locations={activeFloor.locations}
              readOnly={readOnly}
              layout="sheet"
              onWallUpdate={onWallUpdate}
              onWallDelete={onWallDelete}
              onOutlineDelete={onOutlineDelete}
              onHoleUpdate={onHoleUpdate}
              onHoleDelete={onHoleDelete}
              onLocationUpdate={onLocationUpdate}
              onLocationDelete={onLocationDelete}
            />
          </div>
        </div>
      )}

      {/* Floating "↓ show properties" button when something is
          selected but the sheet is collapsed. Lets the user re-open
          without re-clicking the canvas element. */}
      {!propsSheetOpen && selection.kind !== "none" && (
        <button
          type="button"
          onClick={() => setPropsSheetOpen(true)}
          className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-lg"
        >
          <ChevronDown className="size-3.5 rotate-180" />
          Properties
        </button>
      )}
    </div>
  );
}

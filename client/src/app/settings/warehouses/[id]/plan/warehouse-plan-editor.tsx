"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  useLivePlan,
  type CanvasPatchEvent,
  type InvalidationEvent,
  type RemotePlanCursor,
  type SnapshotEvent,
  type SnapshotFloor,
} from "@/lib/realtime/use-live-plan";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { cn } from "@/lib/utils";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { AuditHistoryDialog } from "@/components/audit/audit-history-dialog";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { patchFloorCanvasAction } from "@/lib/floors/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type { Floor, StorageTag, WarehouseReadiness } from "@/lib/types";
import type { ErrorResult } from "@/lib/errors/server";
import { purposeMeta } from "@/lib/storage-cells/purpose";
import type {
  ArrowAnnotation,
  CanvasJson,
  FloorOutline,
  Hole,
  LocalLocation,
  LocationLabelMode,
  PathAnnotation,
  Point,
  SelectionSet,
  TextAnnotation,
  ToolMode,
  Viewport,
  Wall,
} from "./plan-types";
import type { PlanCanvasHandle } from "./plan-canvas";
import { setSnapEnabled } from "./plan-utils";
import {
  AlertTriangle,
  Grid3x3,
  History,
  Keyboard,
  Loader2,
  Maximize2,
  Minimize2,
  Redo2,
  ShieldCheck,
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
  /** Live coverage check from the server — counts per cell purpose +
   *  blocker list for any required purpose with zero cells. Drives the
   *  readiness banner above the editor; the receive endpoint refuses
   *  the same warehouse until every blocker is closed. */
  readiness: WarehouseReadiness;
  floors: Floor[];
  /** Company-wide storage tag registry. Used by the location and
   *  cell tag pickers — operators can only select from this list,
   *  the admin maintains the vocabulary at /settings/storage-tags. */
  storageTags: StorageTag[];
  canEdit: boolean;
}

interface FloorState {
  /** Server-side floor metadata + canvas_json. We never mutate
   *  `meta` after first load; edits live in outline/walls/locations. */
  meta: Floor;
  outline: FloorOutline | undefined;
  walls: Wall[];
  texts: TextAnnotation[];
  arrows: ArrowAnnotation[];
  paths: PathAnnotation[];
  locations: LocalLocation[];
  viewport: Viewport;
  /** True when canvas_json or any location row has been touched. */
  dirty: boolean;
}

interface HistoryEntry {
  outline: FloorOutline | undefined;
  walls: Wall[];
  texts: TextAnnotation[];
  arrows: ArrowAnnotation[];
  paths: PathAnnotation[];
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
    texts: canvas.texts ?? [],
    arrows: canvas.arrows ?? [],
    paths: canvas.paths ?? [],
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
  readiness,
  floors,
  storageTags,
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
  const [selection, setSelection] = useState<SelectionSet>([]);
  const [history, setHistory] = useState<Record<number, HistoryEntry[]>>({});
  const [redoStack, setRedoStack] = useState<Record<number, HistoryEntry[]>>({});
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [saving, startSaving] = useTransition();

  // Fullscreen plan editor — toggles to a `fixed inset-0` overlay
  // that covers the app shell so the whole viewport is canvas.
  // `Shift+F` from anywhere outside an input flips it; `Esc` exits.
  // (Plain `F` is the outline-tool shortcut — moved fullscreen to
  // Shift+F to end the conflict.)
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Keyboard cheatsheet — `?` (i.e. Shift+/) toggles a Dialog
  // listing every shortcut the editor honours. Discoverability for
  // tools + zoom + delete without cluttering the toolbar.
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Right-click context menu. Anchored to screen coords so it can
  // portal above every canvas overlay (toolbar, drawer, floor
  // switcher, remote cursors). Cleared on outside click / Esc / any
  // item click. Only rendered when a selection exists — right-click
  // on empty canvas is a no-op.
  const [contextMenu, setContextMenu] = useState<
    { x: number; y: number } | null
  >(null);

  // Grid snap toggle. Default on — most edits benefit from landing
  // on the 50 cm grid. Off gives the operator pixel-precise placement
  // for fitting around an odd wall. Persisted per-user in localStorage
  // and pushed to plan-utils so every snap site (snapCm, snapPoint,
  // gridSnapDragBound on every Konva shape) picks it up without prop
  // drilling.
  const [snapEnabled, setSnapEnabledState] = useState(true);
  useEffect(() => {
    const stored = window.localStorage.getItem("psp.warehouse-plan.snap-grid");
    if (stored === "off") {
      setSnapEnabledState(false);
      setSnapEnabled(false);
    }
  }, []);
  const onToggleSnap = useCallback(() => {
    setSnapEnabledState((prev) => {
      const next = !prev;
      setSnapEnabled(next);
      window.localStorage.setItem(
        "psp.warehouse-plan.snap-grid",
        next ? "on" : "off",
      );
      return next;
    });
  }, []);

  // What text to put on each location rectangle on the canvas. `code`
  // (the auto-numbered identifier) is the default because it's stable
  // and short, but operators often can't read intent off a code at a
  // glance — `name` and `tags` are the human-friendly alternatives.
  // Persisted per-user in localStorage so the choice survives reloads.
  const [labelMode, setLabelMode] = useState<LocationLabelMode>("code");
  useEffect(() => {
    const stored = window.localStorage.getItem("psp.warehouse-plan.label-mode");
    if (stored === "code" || stored === "name" || stored === "tags") {
      setLabelMode(stored);
    }
  }, []);
  const onLabelModeChange = useCallback((next: LocationLabelMode) => {
    setLabelMode(next);
    window.localStorage.setItem("psp.warehouse-plan.label-mode", next);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
        return;
      }
      // Shift+F toggles fullscreen — plain F is the outline tool
      // shortcut. Ignore when a modifier other than Shift is held so
      // Cmd+F (browser find) still works.
      if (
        e.key === "F" &&
        e.shiftKey &&
        !inField &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        setIsFullscreen((v) => !v);
        return;
      }
      // "?" (Shift+/) toggles the keyboard shortcut cheatsheet.
      if (e.key === "?" && !inField) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  // Seed brand-new floors that arrived via the bottom switcher's
  // "Add floor" button. Preserve any local dirty edits on others.
  useEffect(() => {
    setFloorStates((prev) => {
      const next: Record<number, FloorState> = {};
      for (const f of floors) {
        const existing = prev[f.id];
        if (!existing) {
          next[f.id] = buildFloorState(f);
          continue;
        }
        // The floor's server-side updated_at is the canonical "did
        // anything land on this floor since I last looked?" signal —
        // any location create / update / delete bumps it via the
        // controller's broadcast, and any floor save bumps it too.
        // If it's unchanged we keep our local FloorState intact (the
        // user's mid-edit buffer survives router.refresh from an
        // unrelated source). If it advanced, rebuild from the new
        // meta but preserve unsaved (tempId) drafts that the server
        // doesn't know about yet.
        if (existing.meta.updated_at === f.updated_at) {
          next[f.id] = existing;
          continue;
        }
        const drafts = existing.locations.filter((l) => l.tempId);
        const fresh = buildFloorState(f);
        next[f.id] = {
          ...fresh,
          locations: [...fresh.locations, ...drafts],
        };
      }
      return next;
    });
    if (activeFloorId === null && floors.length > 0) {
      setActiveFloorId(floors[0]!.id);
    }
  }, [floors, activeFloorId]);

  const activeFloor = activeFloorId != null ? floorStates[activeFloorId] : null;
  const anyDirty = Object.values(floorStates).some((s) => s.dirty);

  // Autosave surface. `pending` = debouncer waiting; `saving` = in
  // flight; `saved` = last op succeeded; `error` = last op failed
  // (see setActionError for the detail). `lastSavedAt` drives the
  // "Saved 2s ago" status label; the ticker below makes the label
  // re-render every second without keeping the whole editor in a
  // fast loop.
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "pending" | "saving" | "saved" | "error"
  >("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [savedAgoTick, setSavedAgoTick] = useState(0);
  const autosaveInFlightRef = useRef(false);
  const autosaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!lastSavedAt || saveStatus !== "saved") return;
    const id = setInterval(() => setSavedAgoTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [lastSavedAt, saveStatus]);

  // Tell the lobby presence we're on this warehouse so the
  // /settings/warehouses list still shows the "editing now" pulse on
  // this card while the operator is in the plan tab. Uses the same
  // form-key shape the warehouse edit form does ("warehouse:<uuid>")
  // so the list filter picks both up.
  useFormPresenceBeacon(`warehouse:${warehouseUuid}`);

  // ------------------------------------------------------- live collab
  //
  // Peer mutation arrived — pull the latest server state. The floors
  // useEffect above merges via updated_at so the local user's
  // mid-edit buffer on OTHER floors stays intact, and unsaved
  // drafts (tempId locations) on the affected floor survive too.
  // No banner, no confirmation — the user wanted silent sync.
  const onPeerInvalidation = useCallback(
    (_event: InvalidationEvent) => {
      router.refresh();
    },
    [router],
  );

  // Flag the next `floorStates` update as remote-originated so the
  // canvas-broadcast effect below doesn't echo it back to peers.
  const applyingRemoteRef = useRef(false);

  const onCanvasPatch = useCallback(
    (event: CanvasPatchEvent) => {
      if (!event.canvas) return;
      setFloorStates((prev) => {
        // Match against `meta.uuid` because the broadcast addresses
        // floors by uuid; our state map is keyed by integer pk.
        const entry = Object.entries(prev).find(
          ([, s]) => s.meta.uuid === event.floor_uuid,
        );
        if (!entry) return prev;
        const [idStr, current] = entry;
        const id = Number(idStr);
        const c = event.canvas as {
          outline?: FloorOutline;
          walls?: Wall[];
          texts?: TextAnnotation[];
          arrows?: ArrowAnnotation[];
          paths?: PathAnnotation[];
          locations?: LocalLocation[];
        };
        applyingRemoteRef.current = true;
        return {
          ...prev,
          [id]: {
            ...current,
            outline: c.outline ?? current.outline,
            walls: c.walls ?? current.walls,
            texts: c.texts ?? current.texts,
            arrows: c.arrows ?? current.arrows,
            paths: c.paths ?? current.paths,
            // Storage locations now ride the realtime channel too so
            // a peer dragging a rack, recolouring it, or retagging it
            // shows up live instead of waiting for save+invalidate.
            locations: c.locations ?? current.locations,
          },
        };
      });
    },
    [],
  );

  // Live-collab snapshot bridge. The channel asks every existing
  // peer for the in-progress state when a new tab joins; we serialise
  // our current per-floor canvas from a ref (state would close over a
  // stale snapshot here) and hand it back.
  const floorStatesRef = useRef(floorStates);
  useEffect(() => {
    floorStatesRef.current = floorStates;
  }, [floorStates]);

  const onSnapshotRequest = useCallback((): SnapshotFloor[] => {
    const snapshot: SnapshotFloor[] = [];
    for (const s of Object.values(floorStatesRef.current)) {
      snapshot.push({
        floor_uuid: s.meta.uuid,
        canvas: {
          outline: s.outline,
          walls: s.walls,
          texts: s.texts,
          arrows: s.arrows,
          paths: s.paths,
          // Locations + cells too so a late joiner sees unsaved
          // drags / colour changes / tag edits — not just the
          // architectural layer.
          locations: s.locations,
        },
      });
    }
    return snapshot;
  }, []);

  const onSnapshotReceived = useCallback(
    (event: SnapshotEvent) => {
      setFloorStates((prev) => {
        let next = prev;
        for (const f of event.floors) {
          const entry = Object.entries(next).find(
            ([, s]) => s.meta.uuid === f.floor_uuid,
          );
          if (!entry) continue;
          const [idStr, current] = entry;
          const id = Number(idStr);
          const c = f.canvas as {
            outline?: FloorOutline;
            walls?: Wall[];
            texts?: TextAnnotation[];
            arrows?: ArrowAnnotation[];
            paths?: PathAnnotation[];
            locations?: LocalLocation[];
          };
          applyingRemoteRef.current = true;
          next = {
            ...next,
            [id]: {
              ...current,
              outline: c.outline ?? current.outline,
              walls: c.walls ?? current.walls,
              texts: c.texts ?? current.texts,
              arrows: c.arrows ?? current.arrows,
              paths: c.paths ?? current.paths,
              locations: c.locations ?? current.locations,
            },
          };
        }
        return next;
      });
    },
    [],
  );

  const {
    others: liveOthers,
    creator: liveCreator,
    isCreator: liveIsCreator,
    cursors: liveCursors,
    setCursor: liveSetCursor,
    hideCursor: liveHideCursor,
    broadcastCanvas,
    requestHandoff: liveRequestHandoff,
  } = useLivePlan({
    warehouseUuid,
    activeFloorUuid: activeFloor?.meta.uuid ?? null,
    disabled: readOnly,
    onInvalidated: onPeerInvalidation,
    onSnapshotRequest,
    onSnapshot: onSnapshotReceived,
    onCanvasPatch,
  });

  // Track which (floorUuid, outline, walls, texts, arrows) tuple we
  // last broadcast so we don't fire a redundant push on floor-switch
  // or repeat renders. Reference equality is enough — updateActiveFloor
  // always returns new object refs for mutations.
  const lastSentCanvasRef = useRef<{
    floorUuid: string;
    outline: FloorOutline | undefined;
    walls: Wall[];
    texts: TextAnnotation[];
    arrows: ArrowAnnotation[];
    paths: PathAnnotation[];
    locations: LocalLocation[];
  } | null>(null);

  useEffect(() => {
    if (readOnly) return;
    if (!activeFloor) return;
    if (applyingRemoteRef.current) {
      // Just applied a peer's patch — reset and don't echo it back.
      applyingRemoteRef.current = false;
      lastSentCanvasRef.current = {
        floorUuid: activeFloor.meta.uuid,
        outline: activeFloor.outline,
        walls: activeFloor.walls,
        texts: activeFloor.texts,
        arrows: activeFloor.arrows,
        paths: activeFloor.paths,
        locations: activeFloor.locations,
      };
      return;
    }
    const last = lastSentCanvasRef.current;
    if (
      last &&
      last.floorUuid === activeFloor.meta.uuid &&
      last.outline === activeFloor.outline &&
      last.walls === activeFloor.walls &&
      last.texts === activeFloor.texts &&
      last.arrows === activeFloor.arrows &&
      last.paths === activeFloor.paths &&
      last.locations === activeFloor.locations
    ) {
      return;
    }
    lastSentCanvasRef.current = {
      floorUuid: activeFloor.meta.uuid,
      outline: activeFloor.outline,
      walls: activeFloor.walls,
      texts: activeFloor.texts,
      arrows: activeFloor.arrows,
      paths: activeFloor.paths,
      locations: activeFloor.locations,
    };
    // Skip the very first observation per floor — that's just the
    // initial-state snapshot, not a real edit.
    if (last?.floorUuid !== activeFloor.meta.uuid) return;
    broadcastCanvas(activeFloor.meta.uuid, {
      outline: activeFloor.outline,
      walls: activeFloor.walls,
      texts: activeFloor.texts,
      arrows: activeFloor.arrows,
      paths: activeFloor.paths,
      locations: activeFloor.locations,
    });
  }, [
    activeFloor?.meta.uuid,
    activeFloor?.outline,
    activeFloor?.walls,
    activeFloor?.texts,
    activeFloor?.arrows,
    activeFloor?.paths,
    activeFloor?.locations,
    activeFloor,
    broadcastCanvas,
    readOnly,
  ]);

  // -------------------------------------------------------------- helpers

  const pushHistory = useCallback((floorId: number, state: FloorState) => {
    setHistory((prev) => {
      const stack = prev[floorId] ?? [];
      const entry: HistoryEntry = {
        outline: state.outline,
        walls: state.walls,
        texts: state.texts,
        arrows: state.arrows,
        paths: state.paths,
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
      options?: { snapshot?: boolean; markDirty?: boolean },
    ) => {
      if (activeFloorId == null) return;
      const markDirty = options?.markDirty ?? true;
      setFloorStates((prev) => {
        const current = prev[activeFloorId];
        if (!current) return prev;
        if (options?.snapshot) pushHistory(activeFloorId, current);
        const next = mutator(current);
        return {
          ...prev,
          [activeFloorId]: markDirty ? { ...next, dirty: true } : next,
        };
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
      setSelection([{ kind: "wall", id: wall.id }]);
    },
    [updateActiveFloor],
  );

  const onTextAdded = useCallback(
    (geom: { x: number; y: number; width: number; height: number }) => {
      const text: TextAnnotation = {
        id: `txt_${crypto.randomUUID()}`,
        x: geom.x,
        y: geom.y,
        width: geom.width,
        height: geom.height,
        text: "Text",
        fontSize: 30,
      };
      updateActiveFloor(
        (s) => ({ ...s, texts: [...s.texts, text] }),
        { snapshot: true },
      );
      setTool("select");
      setSelection([{ kind: "text", id: text.id }]);
    },
    [updateActiveFloor],
  );

  const onArrowAdded = useCallback(
    (arrow: ArrowAnnotation) => {
      updateActiveFloor(
        (s) => ({ ...s, arrows: [...s.arrows, arrow] }),
        { snapshot: true },
      );
      setTool("select");
      setSelection([{ kind: "arrow", id: arrow.id }]);
    },
    [updateActiveFloor],
  );

  const onTextUpdate = useCallback(
    (id: string, patch: Partial<TextAnnotation>) => {
      updateActiveFloor((s) => ({
        ...s,
        texts: s.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }));
    },
    [updateActiveFloor],
  );

  const onTextDelete = useCallback(
    (id: string) => {
      updateActiveFloor(
        (s) => ({ ...s, texts: s.texts.filter((t) => t.id !== id) }),
        { snapshot: true },
      );
      setSelection([]);
    },
    [updateActiveFloor],
  );

  const onArrowUpdate = useCallback(
    (id: string, patch: Partial<ArrowAnnotation>) => {
      updateActiveFloor((s) => ({
        ...s,
        arrows: s.arrows.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }));
    },
    [updateActiveFloor],
  );

  const onArrowDelete = useCallback(
    (id: string) => {
      updateActiveFloor(
        (s) => ({ ...s, arrows: s.arrows.filter((a) => a.id !== id) }),
        { snapshot: true },
      );
      setSelection([]);
    },
    [updateActiveFloor],
  );

  const onPathAdded = useCallback(
    (path: PathAnnotation) => {
      updateActiveFloor(
        (s) => ({ ...s, paths: [...s.paths, path] }),
        { snapshot: true },
      );
      setTool("select");
      setSelection([{ kind: "path", id: path.id }]);
    },
    [updateActiveFloor],
  );

  const onPathUpdate = useCallback(
    (id: string, patch: Partial<PathAnnotation>) => {
      updateActiveFloor((s) => ({
        ...s,
        paths: s.paths.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }));
    },
    [updateActiveFloor],
  );

  const onPathDelete = useCallback(
    (id: string) => {
      updateActiveFloor(
        (s) => ({ ...s, paths: s.paths.filter((p) => p.id !== id) }),
        { snapshot: true },
      );
      setSelection([]);
    },
    [updateActiveFloor],
  );

  const onLocationAdded = useCallback(
    (geom: { x: number; y: number; width: number; height: number }) => {
      const tempId = `tmp_${crypto.randomUUID()}`;
      updateActiveFloor(
        (s) => {
          const newLoc: LocalLocation = {
            id: -1,
            uuid: tempId,
            warehouse_id: warehouseId,
            floor_id: s.meta.id,
            // Name is no longer surfaced in the UI — identifier is
            // `code`, auto-generated on save. Leaving as null avoids
            // a stale "Location 1" sticking around in audit diffs.
            name: "",
            code: null,
            x: geom.x,
            y: geom.y,
            width: geom.width,
            height: geom.height,
            width_m: null,
            height_m: null,
            depth_m: null,
            color: null,
            tags: [],
            cells: [],
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
      setSelection([{ kind: "location", id: tempId }]);
    },
    [updateActiveFloor, warehouseId],
  );

  /** Translate every currently-selected item by (dx, dy) centimetres
   *  in a single snapshotted update so undo treats a group drag as
   *  one step. Callers (WallShape / LocationShape) snap dx/dy to the
   *  50cm grid before firing — no clamping happens here. Items that
   *  aren't selected stay put. */
  const onSelectionMove = useCallback(
    (dx: number, dy: number) => {
      if (dx === 0 && dy === 0) return;
      updateActiveFloor(
        (s) => {
          const wallIds = new Set(
            selection
              .filter((it): it is { kind: "wall"; id: string } => it.kind === "wall")
              .map((it) => it.id),
          );
          const locationIds = new Set(
            selection
              .filter(
                (it): it is { kind: "location"; id: string } => it.kind === "location",
              )
              .map((it) => it.id),
          );
          const holeIds = new Set(
            selection
              .filter((it): it is { kind: "hole"; id: string } => it.kind === "hole")
              .map((it) => it.id),
          );
          const textIds = new Set(
            selection
              .filter((it): it is { kind: "text"; id: string } => it.kind === "text")
              .map((it) => it.id),
          );
          const arrowIds = new Set(
            selection
              .filter((it): it is { kind: "arrow"; id: string } => it.kind === "arrow")
              .map((it) => it.id),
          );
          const pathIds = new Set(
            selection
              .filter((it): it is { kind: "path"; id: string } => it.kind === "path")
              .map((it) => it.id),
          );
          const outlineSelected = selection.some((it) => it.kind === "outline");

          const walls = wallIds.size
            ? s.walls.map((w) =>
                wallIds.has(w.id)
                  ? { ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy }
                  : w,
              )
            : s.walls;

          const locations = locationIds.size
            ? s.locations.map((l) =>
                locationIds.has(String(l.tempId ?? l.uuid))
                  ? { ...l, x: l.x + dx, y: l.y + dy, dirty: true }
                  : l,
              )
            : s.locations;

          const texts = textIds.size
            ? s.texts.map((t) =>
                textIds.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t,
              )
            : s.texts;

          const arrows = arrowIds.size
            ? s.arrows.map((a) =>
                arrowIds.has(a.id)
                  ? {
                      ...a,
                      x1: a.x1 + dx,
                      y1: a.y1 + dy,
                      x2: a.x2 + dx,
                      y2: a.y2 + dy,
                    }
                  : a,
              )
            : s.arrows;

          const paths = pathIds.size
            ? s.paths.map((p) =>
                pathIds.has(p.id)
                  ? {
                      ...p,
                      points: p.points.map((pt) => ({
                        x: pt.x + dx,
                        y: pt.y + dy,
                      })),
                    }
                  : p,
              )
            : s.paths;

          let outline = s.outline;
          if (outline && (outlineSelected || holeIds.size)) {
            outline = {
              ...outline,
              points: outlineSelected
                ? outline.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
                : outline.points,
              holes: outline.holes?.map((h) =>
                outlineSelected || holeIds.has(h.id)
                  ? { ...h, points: h.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
                  : h,
              ),
            };
          }

          return { ...s, walls, locations, texts, arrows, paths, outline };
        },
        { snapshot: true },
      );
    },
    [selection, updateActiveFloor],
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

  /** Bow handle drag commits via this — snapshotted so undo treats
   *  the curve change as a discrete step. Forwarded to the canvas
   *  via the WallShape's onBowChange hook. */
  const onWallBowChange = useCallback(
    (id: string, bow: number) => {
      updateActiveFloor(
        (s) => ({
          ...s,
          walls: s.walls.map((w) =>
            w.id === id ? { ...w, bow: bow === 0 ? undefined : bow } : w,
          ),
        }),
        { snapshot: true },
      );
    },
    [updateActiveFloor],
  );

  /** Apply a new bow value to one edge of the floor outline. The
   *  edgeBows array is stored sparsely — if every entry collapses
   *  to 0 we drop the array entirely to keep canvas_json tidy. */
  const onOutlineEdgeBowChange = useCallback(
    (index: number, bow: number) => {
      updateActiveFloor(
        (s) => {
          if (!s.outline) return s;
          const n = s.outline.points.length;
          const next = Array.from({ length: n }, (_, i) =>
            i === index ? bow : s.outline?.edgeBows?.[i] ?? 0,
          );
          const allZero = next.every((v) => !v || Math.abs(v) < 0.5);
          return {
            ...s,
            outline: {
              ...s.outline,
              edgeBows: allZero ? undefined : next,
            },
          };
        },
        { snapshot: true },
      );
    },
    [updateActiveFloor],
  );

  const onHoleEdgeBowChange = useCallback(
    (holeId: string, index: number, bow: number) => {
      updateActiveFloor(
        (s) => {
          if (!s.outline?.holes) return s;
          return {
            ...s,
            outline: {
              ...s.outline,
              holes: s.outline.holes.map((h) => {
                if (h.id !== holeId) return h;
                const n = h.points.length;
                const next = Array.from({ length: n }, (_, i) =>
                  i === index ? bow : h.edgeBows?.[i] ?? 0,
                );
                const allZero = next.every((v) => !v || Math.abs(v) < 0.5);
                return { ...h, edgeBows: allZero ? undefined : next };
              }),
            },
          };
        },
        { snapshot: true },
      );
    },
    [updateActiveFloor],
  );

  const onWallDelete = useCallback(
    (id: string) => {
      updateActiveFloor(
        (s) => ({ ...s, walls: s.walls.filter((w) => w.id !== id) }),
        { snapshot: true },
      );
      setSelection([]);
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
      setSelection([]);
    },
    [updateActiveFloor],
  );

  const onViewportChange = useCallback(
    (next: Viewport) => {
      // Viewport update WITHOUT marking dirty. Panning / zooming
      // shouldn't fire autosave — otherwise every scroll ships a
      // full canvas_json PATCH just because the camera moved. The
      // new camera position piggybacks on the next real content
      // autosave (dirty state includes the whole canvas_json), so
      // when you actually edit something, the current zoom persists
      // too. Trade-off: if you only pan / zoom and never edit, the
      // viewport won't persist across reloads. Acceptable — a mild
      // ergonomic loss to avoid save-on-scroll spam.
      updateActiveFloor((s) => ({ ...s, viewport: next }), {
        markDirty: false,
      });
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
      setSelection([{ kind: "outline" }]);
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
      setSelection([{ kind: "hole", id: holeId }]);
    },
    [updateActiveFloor],
  );

  const onOutlineDelete = useCallback(() => {
    updateActiveFloor(
      (s) => ({ ...s, outline: undefined }),
      { snapshot: true },
    );
    setSelection([]);
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

  /** Patch metadata on the outline itself (currently just `color`).
   *  Snapshotted so each paint lands as a discrete undo step. */
  const onOutlineUpdate = useCallback(
    (patch: Partial<FloorOutline>) => {
      updateActiveFloor(
        (s) => {
          if (!s.outline) return s;
          return { ...s, outline: { ...s.outline, ...patch } };
        },
        { snapshot: true },
      );
    },
    [updateActiveFloor],
  );

  /** Paint every currently-selected item the same colour in one
   *  snapshot. Walls / outline / holes store the override in
   *  canvas_json; locations store it as a real column. Pass `null`
   *  to clear (reset to the type's default palette). */
  // Wrap setCursor to inject the active floor uuid — the canvas
  // doesn't know which floor it's drawing, the editor does.
  const onCanvasCursorMove = useCallback(
    (worldX: number, worldY: number) => {
      const uuid = activeFloor?.meta.uuid;
      if (!uuid) return;
      liveSetCursor(worldX, worldY, uuid);
    },
    [activeFloor?.meta.uuid, liveSetCursor],
  );

  const onSelectionColor = useCallback(
    (color: string | null) => {
      const cMaybe = color ?? undefined;
      updateActiveFloor(
        (s) => {
          const wallIds = new Set(
            selection
              .filter(
                (it): it is { kind: "wall"; id: string } => it.kind === "wall",
              )
              .map((it) => it.id),
          );
          const holeIds = new Set(
            selection
              .filter(
                (it): it is { kind: "hole"; id: string } => it.kind === "hole",
              )
              .map((it) => it.id),
          );
          const locationIds = new Set(
            selection
              .filter(
                (it): it is { kind: "location"; id: string } =>
                  it.kind === "location",
              )
              .map((it) => it.id),
          );
          const textIds = new Set(
            selection
              .filter((it): it is { kind: "text"; id: string } => it.kind === "text")
              .map((it) => it.id),
          );
          const arrowIds = new Set(
            selection
              .filter((it): it is { kind: "arrow"; id: string } => it.kind === "arrow")
              .map((it) => it.id),
          );
          const pathIds = new Set(
            selection
              .filter((it): it is { kind: "path"; id: string } => it.kind === "path")
              .map((it) => it.id),
          );
          const outlineSelected = selection.some((it) => it.kind === "outline");

          const walls = wallIds.size
            ? s.walls.map((w) =>
                wallIds.has(w.id) ? { ...w, color: cMaybe } : w,
              )
            : s.walls;

          const locations = locationIds.size
            ? s.locations.map((l) =>
                locationIds.has(String(l.tempId ?? l.uuid))
                  ? { ...l, color: color, dirty: true }
                  : l,
              )
            : s.locations;

          const texts = textIds.size
            ? s.texts.map((t) =>
                textIds.has(t.id) ? { ...t, color: cMaybe } : t,
              )
            : s.texts;

          const arrows = arrowIds.size
            ? s.arrows.map((a) =>
                arrowIds.has(a.id) ? { ...a, color: cMaybe } : a,
              )
            : s.arrows;

          const paths = pathIds.size
            ? s.paths.map((p) =>
                pathIds.has(p.id) ? { ...p, color: cMaybe } : p,
              )
            : s.paths;

          let outline = s.outline;
          if (outline && (outlineSelected || holeIds.size)) {
            outline = {
              ...outline,
              color: outlineSelected ? cMaybe : outline.color,
              holes: outline.holes?.map((h) =>
                holeIds.has(h.id) ? { ...h, color: cMaybe } : h,
              ),
            };
          }

          return { ...s, walls, locations, texts, arrows, paths, outline };
        },
        { snapshot: true },
      );
    },
    [selection, updateActiveFloor],
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
      setSelection([]);
    },
    [updateActiveFloor],
  );

  /** Bulk-delete everything in the current selection. One snapshot
   *  for the whole operation so undo restores it as a single step. */
  const onDeleteSelected = useCallback(() => {
    if (selection.length === 0) return;
    updateActiveFloor(
      (s) => {
        const wallIds = new Set(
          selection
            .filter((it): it is { kind: "wall"; id: string } => it.kind === "wall")
            .map((it) => it.id),
        );
        const holeIds = new Set(
          selection
            .filter((it): it is { kind: "hole"; id: string } => it.kind === "hole")
            .map((it) => it.id),
        );
        const locationIds = new Set(
          selection
            .filter(
              (it): it is { kind: "location"; id: string } =>
                it.kind === "location",
            )
            .map((it) => it.id),
        );
        const textIds = new Set(
          selection
            .filter((it): it is { kind: "text"; id: string } => it.kind === "text")
            .map((it) => it.id),
        );
        const arrowIds = new Set(
          selection
            .filter((it): it is { kind: "arrow"; id: string } => it.kind === "arrow")
            .map((it) => it.id),
        );
        const pathIds = new Set(
          selection
            .filter((it): it is { kind: "path"; id: string } => it.kind === "path")
            .map((it) => it.id),
        );
        const dropOutline = selection.some((it) => it.kind === "outline");

        return {
          ...s,
          outline: dropOutline
            ? undefined
            : s.outline
              ? {
                  ...s.outline,
                  holes: (s.outline.holes ?? []).filter(
                    (h) => !holeIds.has(h.id),
                  ),
                }
              : s.outline,
          walls: s.walls.filter((w) => !wallIds.has(w.id)),
          texts: s.texts.filter((t) => !textIds.has(t.id)),
          arrows: s.arrows.filter((a) => !arrowIds.has(a.id)),
          paths: s.paths.filter((p) => !pathIds.has(p.id)),
          locations: s.locations.map((l) => {
            const id = l.tempId ?? l.uuid;
            if (!locationIds.has(id)) return l;
            return l.tempId
              ? { ...l, deleted: true }
              : { ...l, deleted: true, dirty: true };
          }),
        };
      },
      { snapshot: true },
    );
    setSelection([]);
  }, [selection, updateActiveFloor]);

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
            texts: current.texts,
            arrows: current.arrows,
            paths: current.paths,
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
          texts: last.texts,
          arrows: last.arrows,
          paths: last.paths,
          locations: last.locations,
          dirty: true,
        },
      };
    });
    setHistory((prev) => ({ ...prev, [activeFloorId]: stack.slice(0, -1) }));
    setSelection([]);
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
            texts: current.texts,
            arrows: current.arrows,
            paths: current.paths,
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
          texts: last.texts,
          arrows: last.arrows,
          paths: last.paths,
          locations: last.locations,
          dirty: true,
        },
      };
    });
    setRedoStack((prev) => ({ ...prev, [activeFloorId]: stack.slice(0, -1) }));
    setSelection([]);
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
        case "t":
          setTool("text");
          break;
        case "a":
          setTool("arrow");
          break;
        case "r":
          setTool("path");
          break;
        case "escape":
          canvasRef.current?.cancelDraft();
          setSelection([]);
          break;
        case "delete":
        case "backspace":
          if (selection.length > 0) {
            e.preventDefault();
            onDeleteSelected();
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, readOnly, activeFloor?.outline, selection.length, onDeleteSelected]);

  // ----------------------------------------------------------- save flow

  const canvasJsonFor = useCallback((s: FloorState): CanvasJson => {
    return {
      viewport: s.viewport,
      outline: s.outline,
      walls: s.walls,
      texts: s.texts.length > 0 ? s.texts : undefined,
      arrows: s.arrows.length > 0 ? s.arrows : undefined,
      paths: s.paths.length > 0 ? s.paths : undefined,
    };
  }, []);

  // Roll every local edit back to the last-known-good server state
  // for a floor. Fires on any autosave failure so the canvas stops
  // showing changes that never actually landed. Viewport is
  // preserved from the current local state — the user's camera
  // isn't a "change" and shouldn't snap back to the last-saved
  // position just because a write failed.
  const rollbackFloorToServer = useCallback(
    (floorId: number) => {
      setFloorStates((prev) => {
        const current = prev[floorId];
        if (!current) return prev;
        const fresh = buildFloorState(current.meta);
        return {
          ...prev,
          [floorId]: { ...fresh, viewport: current.viewport },
        };
      });
      // Clear undo / redo — those stacks are relative to the
      // rolled-back state and would replay non-existent edits.
      setHistory((prev) => ({ ...prev, [floorId]: [] }));
      setRedoStack((prev) => ({ ...prev, [floorId]: [] }));
      setSelection([]);
    },
    [],
  );

  const onSave = useCallback(() => {
    if (!activeFloor) return;
    // Only the room owner persists — non-creators' edits stay local
    // (banner + head-of-room handoff will handle this in a follow-up
    // PR; today the debounce effect never calls onSave when
    // !liveIsCreator).
    if (!liveIsCreator) return;
    // Re-entrancy guard: autosave debounce may fire again mid-flight
    // if the user keeps editing. Skip; the debounce will re-schedule
    // when the flag clears.
    if (autosaveInFlightRef.current) return;

    autosaveInFlightRef.current = true;
    setSaveStatus("saving");
    setActionError(null);

    // Snapshot the batch of rows this save is responsible for so the
    // completion pass only clears dirty flags on rows we actually
    // saved. Anything the user touches during the round-trip stays
    // dirty and re-triggers the debouncer.
    const state = activeFloor;
    const newRows = state.locations.filter((l) => l.tempId && !l.deleted);
    const dirtyRows = state.locations.filter(
      (l) => !l.tempId && l.dirty && !l.deleted,
    );
    const deletedRows = state.locations.filter((l) => !l.tempId && l.deleted);
    const savedTempIds = new Set(newRows.map((l) => l.tempId!));
    const savedUuids = new Set([
      ...dirtyRows.map((l) => l.uuid),
      ...deletedRows.map((l) => l.uuid),
    ]);

    startSaving(async () => {
      const floorRes = await patchFloorCanvasAction(
        warehouseUuid,
        state.meta.uuid,
        canvasJsonFor(state) as unknown as Record<string, unknown>,
      );

      if (!floorRes.ok) {
        setActionError(floorRes);
        setSaveStatus("error");
        autosaveInFlightRef.current = false;
        rollbackFloorToServer(state.meta.id);
        toast.error("Save failed — reverted changes", {
          description: floorRes.detail,
        });
        return;
      }

      // Also stash the server-assigned code so the canvas label
      // refreshes from "(unsaved)" → "SL00012" on save without a
      // round-trip through router.refresh().
      const tempIdToServerData = new Map<
        string,
        { id: number; uuid: string; code: string | null }
      >();

      for (const loc of newRows) {
        const res = await createLocationAction(warehouseUuid, {
          floor_uuid: state.meta.uuid,
          name: loc.name,
          code: loc.code,
          x: loc.x,
          y: loc.y,
          width: loc.width,
          height: loc.height,
          width_m: loc.width_m,
          height_m: loc.height_m,
          depth_m: loc.depth_m,
          notes: loc.notes,
          color: loc.color,
          tags: loc.tags ?? [],
        });
        if (!res.ok) {
          setActionError(res);
          setSaveStatus("error");
          autosaveInFlightRef.current = false;
          rollbackFloorToServer(state.meta.id);
          toast.error("Save failed — reverted changes", {
            description: res.detail,
          });
          return;
        }
        if (loc.tempId) {
          tempIdToServerData.set(loc.tempId, {
            id: res.storage_location.id,
            uuid: res.storage_location.uuid,
            code: res.storage_location.code,
          });
        }
      }

      const opResults = await Promise.all([
        ...dirtyRows.map((loc) =>
          updateLocationAction(warehouseUuid, loc.uuid, {
            name: loc.name,
            code: loc.code,
            x: loc.x,
            y: loc.y,
            width: loc.width,
            height: loc.height,
            width_m: loc.width_m,
            height_m: loc.height_m,
            depth_m: loc.depth_m,
            notes: loc.notes,
            color: loc.color,
            tags: loc.tags ?? [],
          }),
        ),
        ...deletedRows.map((loc) =>
          deleteLocationAction(warehouseUuid, loc.uuid),
        ),
      ]);

      const firstFailure = opResults.find((r) => !r.ok);
      if (firstFailure && !firstFailure.ok) {
        setActionError(firstFailure);
        setSaveStatus("error");
        autosaveInFlightRef.current = false;
        rollbackFloorToServer(state.meta.id);
        toast.error("Save failed — reverted changes", {
          description: firstFailure.detail,
        });
        return;
      }

      setFloorStates((prev) => {
        const current = prev[state.meta.id];
        if (!current) return prev;
        // Race-safe merge: only clear dirty on the specific rows this
        // save covered. Any row the user touched *after* we snapshot
        // above still shows dirty and stays in the autosave queue.
        const merged: LocalLocation[] = current.locations
          .filter((l) => {
            // Drop rows that were tombstoned + successfully deleted;
            // rows tombstoned after we started keep their tombstone
            // (they'll delete on the next tick).
            if (l.deleted && !l.tempId && savedUuids.has(l.uuid)) return false;
            return true;
          })
          .map((l) => {
            if (l.tempId && savedTempIds.has(l.tempId)) {
              const remote = tempIdToServerData.get(l.tempId);
              if (remote) {
                return {
                  ...l,
                  id: remote.id,
                  uuid: remote.uuid,
                  code: remote.code,
                  tempId: undefined,
                  dirty: false,
                };
              }
              return l;
            }
            if (!l.tempId && savedUuids.has(l.uuid) && !l.deleted) {
              return { ...l, dirty: false };
            }
            return l;
          });
        // Floor.dirty only clears if the canvas we just saved is
        // still equal to what's in state. Cheap approximation:
        // clear it — the debounce effect will re-fire on the next
        // edit anyway if state.canvas has diverged.
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
      setSaveStatus("saved");
      setLastSavedAt(new Date());
      autosaveInFlightRef.current = false;
    });
  }, [
    activeFloor,
    canvasJsonFor,
    liveIsCreator,
    rollbackFloorToServer,
    warehouseId,
    warehouseUuid,
  ]);

  // Debounced autosave. Any dirty state (floor canvas OR any
  // location row) resets an 800ms timer; when it fires, onSave
  // runs. The re-entrancy guard in onSave handles the case where
  // the user keeps editing during a save round-trip.
  //
  // Head-of-room preserved: non-creators bypass this entirely, so
  // their local edits stay local until either they become creator
  // (via the earliest-joiner rule after the current creator leaves)
  // or the take-over button lands in a follow-up PR.
  useEffect(() => {
    if (!activeFloor) return;
    if (!liveIsCreator) return;

    const isDirty =
      activeFloor.dirty ||
      activeFloor.locations.some(
        (l) => l.dirty || l.tempId != null || l.deleted,
      );
    if (!isDirty) return;

    setSaveStatus("pending");

    if (autosaveDebounceRef.current) clearTimeout(autosaveDebounceRef.current);
    autosaveDebounceRef.current = setTimeout(() => {
      onSave();
    }, 800);

    return () => {
      if (autosaveDebounceRef.current) {
        clearTimeout(autosaveDebounceRef.current);
        autosaveDebounceRef.current = null;
      }
    };
  }, [activeFloor, liveIsCreator, onSave]);

  const onDiscard = useCallback(() => {
    if (!activeFloor) return;
    const reset = buildFloorState(activeFloor.meta);
    setFloorStates((prev) => ({ ...prev, [activeFloor.meta.id]: reset }));
    setHistory((prev) => ({ ...prev, [activeFloor.meta.id]: [] }));
    setRedoStack((prev) => ({ ...prev, [activeFloor.meta.id]: [] }));
    setSelection([]);
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

  // Mobile cap: roughly half the viewport so the toolbar + selected-
  // item properties below have room to live without forcing a tap-
  // and-scroll loop. Desktop stays at a roomy fixed 600.
  const canvasHeight = isMobile
    ? Math.max(
        300,
        Math.min(
          480,
          typeof window === "undefined"
            ? 420
            : Math.round(window.innerHeight * 0.55),
        ),
      )
    : 600;

  // Desktop uses a full-bleed frame — canvas fills the space and the
  // toolbar / properties / floor switcher float over it (Miro style).
  // Mobile keeps the current stacked layout because a floating drawer
  // on a phone is a UX trap.
  const desktopFrameClass = isMobile
    ? isFullscreen
      ? "fixed inset-0 z-50 flex flex-col gap-3 overflow-auto bg-background p-4"
      : "space-y-3"
    : isFullscreen
      ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-background"
      : "flex flex-col overflow-hidden rounded-xl border border-border/60 bg-background h-[calc(100dvh-11rem)] min-h-[560px]";

  return (
    <div className={desktopFrameClass}>

      <KeyboardShortcutsOverlay
        open={showShortcuts}
        onOpenChange={setShowShortcuts}
        hasOutline={!!activeFloor?.outline}
      />

      <div className={cn(!isMobile && "px-3 pt-3")}>
        <ReadinessBanner
          readiness={readiness}
          warehouseName={warehouseName}
          canEdit={canEdit}
        />
      </div>

      {/* Header row — slim border-bounded strip on desktop, stacked on mobile */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-2",
          !isMobile && "border-b border-border/60 px-3 py-2",
        )}
      >
        <SaveStatusPill
          status={saveStatus}
          lastSavedAt={lastSavedAt}
          savedAgoTick={savedAgoTick}
          isCreator={liveIsCreator}
          creatorName={liveCreator?.name}
          hasDirty={anyDirty}
        />
        {!liveIsCreator && liveCreator && !readOnly && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={liveRequestHandoff}
            title={`Take over head-of-room from ${liveCreator.name}`}
          >
            Take over
          </Button>
        )}
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

        <div className="ml-auto flex items-center gap-2">
          {/* Presence avatar stack — only others, the current user
              already sees themselves represented by the editor's
              ownership cues (cursor, save button, etc.). */}
          {liveOthers.length > 0 && (
            <CollabAvatars peers={liveOthers} max={4} className="hidden sm:flex" />
          )}
          {activeFloor && (
            <AuditHistoryDialog
              entityType="floor"
              entityId={activeFloor.meta.id}
              title={`History · ${activeFloor.meta.name}`}
              description="Every save of this floor's plan, with who changed what and when."
              canRestore={false}
              trigger={
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  title="Floor history"
                  aria-label="Floor history"
                >
                  <History className="size-4" />
                </Button>
              }
            />
          )}
          <LabelModeSelect
            value={labelMode}
            onChange={onLabelModeChange}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onToggleSnap}
            title={
              snapEnabled
                ? "Snap to 50 cm grid: on (click to allow pixel-precise placement)"
                : "Snap to 50 cm grid: off (click to re-enable)"
            }
            aria-label={
              snapEnabled ? "Disable grid snap" : "Enable grid snap"
            }
            className={cn(!snapEnabled && "text-muted-foreground/60")}
          >
            <Grid3x3 className="size-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setShowShortcuts(true)}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            <Keyboard className="size-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setIsFullscreen((v) => !v)}
            title={
              isFullscreen
                ? "Exit fullscreen (Shift+F or Esc)"
                : "Fullscreen editor (Shift+F)"
            }
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen editor"}
          >
            {isFullscreen ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
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
                  title={
                    liveIsCreator
                      ? "Discard local changes before the next autosave fires"
                      : "Reset local changes — only the head of room can save"
                  }
                >
                  Discard
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {actionError && (
        <div className={cn(!isMobile && "border-b border-border/60 px-3 py-2")}>
          <ErrorBanner
            detail={actionError.detail}
            code={actionError.code}
            debug={actionError.debug}
          />
        </div>
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
          labelMode={labelMode}
          readOnly={readOnly}
          warehouseUuid={warehouseUuid}
          storageTags={storageTags}
          onViewportChange={onViewportChange}
          onWallAdded={onWallAdded}
          onWallBowChange={onWallBowChange}
          onOutlineEdgeBowChange={onOutlineEdgeBowChange}
          onHoleEdgeBowChange={onHoleEdgeBowChange}
          onLocationAdded={onLocationAdded}
          onTextAdded={onTextAdded}
          onTextEdit={(id, content) => onTextUpdate(id, { text: content })}
          onArrowAdded={onArrowAdded}
          onPathAdded={onPathAdded}
          onSelectionMove={onSelectionMove}
          onCursorMove={onCanvasCursorMove}
          onCursorLeave={liveHideCursor}
          remoteCursors={liveCursors}
          onOutlineCommitted={onOutlineCommitted}
          onHoleCommitted={onHoleCommitted}
          onWallUpdate={onWallUpdate}
          onWallDelete={onWallDelete}
          onOutlineUpdate={onOutlineUpdate}
          onOutlineDelete={onOutlineDelete}
          onHoleUpdate={onHoleUpdate}
          onHoleDelete={onHoleDelete}
          onTextUpdate={onTextUpdate}
          onTextDelete={onTextDelete}
          onArrowUpdate={onArrowUpdate}
          onArrowDelete={onArrowDelete}
          onPathUpdate={onPathUpdate}
          onPathDelete={onPathDelete}
          onLocationUpdate={onLocationUpdate}
          onLocationDelete={onLocationDelete}
          onSelectionColor={onSelectionColor}
          onDeleteSelected={onDeleteSelected}
        />
      ) : (
        // Desktop — Miro-style floating layout. Canvas fills the
        // frame; toolbar / properties drawer / floor switcher float
        // on top with backdrop-blur so the operator sees as much of
        // the plan as possible.
        <div className="relative flex-1 min-h-0">
          {activeFloor ? (
            <PlanCanvas
              ref={canvasRef}
              outline={activeFloor.outline}
              walls={activeFloor.walls}
              texts={activeFloor.texts}
              arrows={activeFloor.arrows}
              paths={activeFloor.paths}
              locations={activeFloor.locations}
              selection={selection}
              tool={tool}
              viewport={activeFloor.viewport}
              labelMode={labelMode}
              readOnly={readOnly}
              onSelectionChange={setSelection}
              onViewportChange={onViewportChange}
              onWallAdded={onWallAdded}
              onWallBowChange={onWallBowChange}
              onOutlineEdgeBowChange={onOutlineEdgeBowChange}
              onHoleEdgeBowChange={onHoleEdgeBowChange}
              onLocationAdded={onLocationAdded}
              onTextAdded={onTextAdded}
              onTextEdit={(id, content) => onTextUpdate(id, { text: content })}
              onArrowAdded={onArrowAdded}
              onPathAdded={onPathAdded}
              onSelectionMove={onSelectionMove}
              onCursorMove={onCanvasCursorMove}
              onCursorLeave={liveHideCursor}
              remoteCursors={liveCursors}
              onOutlineCommitted={onOutlineCommitted}
              onHoleCommitted={onHoleCommitted}
              onContextMenuAt={(x, y) => {
                // No menu when nothing's selected — right-click on
                // empty canvas is a no-op instead of showing a stub.
                if (selection.length === 0) return;
                setContextMenu({ x, y });
              }}
              onLocationLabelEdit={(id, name) => {
                if (readOnly) return;
                if (name === "") return;
                onLocationUpdate(id, { name });
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-muted/30 text-sm text-muted-foreground">
              Select a floor below to start editing.
            </div>
          )}

          {contextMenu && (
            <PlanContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              selectionCount={selection.length}
              disabled={readOnly || !liveIsCreator}
              onClose={() => setContextMenu(null)}
              onDelete={() => {
                setContextMenu(null);
                onDeleteSelected();
              }}
              onDeselect={() => {
                setContextMenu(null);
                setSelection([]);
              }}
            />
          )}

          {/* Floating toolbar rail — full height along the left edge
              so the mt-auto zoom cluster still pins to the bottom. */}
          <div className="pointer-events-none absolute inset-y-3 left-3 z-20">
            <div className="pointer-events-auto h-full">
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
            </div>
          </div>

          {/* Floating properties drawer — right edge, slides in when
              a selection exists so the canvas stays uncovered when
              the operator is just navigating. */}
          <div
            className={cn(
              "pointer-events-none absolute right-3 top-3 bottom-16 z-30 transition-transform duration-200",
              selection.length === 0 && "translate-x-[calc(100%+1rem)]",
            )}
            aria-hidden={selection.length === 0}
          >
            <div className="pointer-events-auto h-full shadow-xl">
              <PlanProperties
                selection={selection}
                outline={activeFloor?.outline}
                walls={activeFloor?.walls ?? []}
                texts={activeFloor?.texts ?? []}
                arrows={activeFloor?.arrows ?? []}
                paths={activeFloor?.paths ?? []}
                locations={activeFloor?.locations ?? []}
                warehouseUuid={warehouseUuid}
                storageTags={storageTags}
                readOnly={readOnly}
                layout="side"
                onWallUpdate={onWallUpdate}
                onWallDelete={onWallDelete}
                onOutlineUpdate={onOutlineUpdate}
                onOutlineDelete={onOutlineDelete}
                onHoleUpdate={onHoleUpdate}
                onHoleDelete={onHoleDelete}
                onOutlineEdgeBowChange={onOutlineEdgeBowChange}
                onHoleEdgeBowChange={onHoleEdgeBowChange}
                onTextUpdate={onTextUpdate}
                onTextDelete={onTextDelete}
                onArrowUpdate={onArrowUpdate}
                onArrowDelete={onArrowDelete}
                onPathUpdate={onPathUpdate}
                onPathDelete={onPathDelete}
                onLocationUpdate={onLocationUpdate}
                onLocationDelete={onLocationDelete}
                onSelectionColor={onSelectionColor}
                onDeleteSelected={onDeleteSelected}
              />
            </div>
          </div>

          {/* Floating floor switcher — bottom-centre, always visible. */}
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
            <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border/60 bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur">
              <PlanFloorSwitcher
                floors={floors}
                activeFloorId={activeFloorId}
                onSelect={(id) => {
                  setActiveFloorId(id);
                  setSelection([]);
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
        </div>
      )}

      {/* Mobile floor switcher — sits below the canvas since a
          floating bottom overlay would fight the on-screen keyboard. */}
      {isMobile && (
        <div className="flex flex-wrap items-center gap-2">
          <PlanFloorSwitcher
            floors={floors}
            activeFloorId={activeFloorId}
            onSelect={(id) => {
              setActiveFloorId(id);
              setSelection([]);
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
      )}
    </div>
  );
}

// ---------------------------------------------------------------- mobile

interface MobileLayoutProps {
  activeFloor: FloorState | null;
  canvasRef: React.MutableRefObject<PlanCanvasHandle | null>;
  tool: ToolMode;
  setTool: (t: ToolMode) => void;
  selection: SelectionSet;
  setSelection: (s: SelectionSet) => void;
  canvasHeight: number;
  labelMode: LocationLabelMode;
  readOnly: boolean;
  warehouseUuid: string;
  storageTags: StorageTag[];
  onViewportChange: (v: Viewport) => void;
  onWallAdded: (w: Wall) => void;
  onWallBowChange: (id: string, bow: number) => void;
  onOutlineEdgeBowChange: (index: number, bow: number) => void;
  onHoleEdgeBowChange: (holeId: string, index: number, bow: number) => void;
  onLocationAdded: (g: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onTextAdded: (g: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onTextEdit: (id: string, text: string) => void;
  onArrowAdded: (arrow: ArrowAnnotation) => void;
  onPathAdded: (path: PathAnnotation) => void;
  onSelectionMove: (dx: number, dy: number) => void;
  onCursorMove: (worldX: number, worldY: number) => void;
  onCursorLeave: () => void;
  remoteCursors: Record<string, RemotePlanCursor>;
  onOutlineCommitted: (points: Point[]) => void;
  onHoleCommitted: (points: Point[]) => void;
  onWallUpdate: (id: string, patch: Partial<Wall>) => void;
  onWallDelete: (id: string) => void;
  onOutlineUpdate: (patch: Partial<FloorOutline>) => void;
  onOutlineDelete: () => void;
  onHoleUpdate: (id: string, patch: Partial<Hole>) => void;
  onHoleDelete: (id: string) => void;
  onTextUpdate: (id: string, patch: Partial<TextAnnotation>) => void;
  onTextDelete: (id: string) => void;
  onArrowUpdate: (id: string, patch: Partial<ArrowAnnotation>) => void;
  onArrowDelete: (id: string) => void;
  onPathUpdate: (id: string, patch: Partial<PathAnnotation>) => void;
  onPathDelete: (id: string) => void;
  onLocationUpdate: (
    id: string | number,
    patch: Partial<Omit<LocalLocation, "id" | "uuid" | "tempId">>,
  ) => void;
  onLocationDelete: (id: string | number) => void;
  onSelectionColor: (color: string | null) => void;
  onDeleteSelected: () => void;
}

/**
 * Mobile layout: canvas takes most of the viewport; toolbar pinned
 * below; properties slide up as a bottom sheet on selection.
 *
 * Memoized so a peer's cursor tick on the shared plan channel — which
 * re-renders the outer editor — doesn't force a full mobile-layout
 * reconciliation when the layout's own props haven't changed.
 */
const MobileLayout = memo(function MobileLayout({
  activeFloor,
  canvasRef,
  tool,
  setTool,
  selection,
  setSelection,
  canvasHeight,
  labelMode,
  readOnly,
  warehouseUuid,
  storageTags,
  onViewportChange,
  onWallAdded,
  onWallBowChange,
  onOutlineEdgeBowChange,
  onHoleEdgeBowChange,
  onLocationAdded,
  onTextAdded,
  onTextEdit,
  onArrowAdded,
  onPathAdded,
  onSelectionMove,
  onCursorMove,
  onCursorLeave,
  remoteCursors,
  onOutlineCommitted,
  onHoleCommitted,
  onWallUpdate,
  onWallDelete,
  onOutlineUpdate,
  onOutlineDelete,
  onHoleUpdate,
  onHoleDelete,
  onTextUpdate,
  onTextDelete,
  onArrowUpdate,
  onArrowDelete,
  onPathUpdate,
  onPathDelete,
  onLocationUpdate,
  onLocationDelete,
  onSelectionColor,
  onDeleteSelected,
}: MobileLayoutProps) {
  // Anchor for the inline properties section — when something is
  // selected we scroll it into view so the operator doesn't have
  // to drag the page after every tap.
  const propsAnchorRef = useRef<HTMLDivElement | null>(null);
  const lastSelectionKey = selection
    .map((it) => `${it.kind}:${"id" in it ? it.id : "index" in it ? it.index : ""}`)
    .join("|");
  useEffect(() => {
    if (selection.length === 0) return;
    // Brief defer so the section renders before we measure / scroll.
    const t = setTimeout(() => {
      propsAnchorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSelectionKey]);
  return (
    <div className="relative">
      <div
        style={{ height: canvasHeight }}
        className="overflow-hidden rounded-md border border-border/60"
      >
        {activeFloor ? (
          <PlanCanvas
            ref={canvasRef}
            outline={activeFloor.outline}
            walls={activeFloor.walls}
            texts={activeFloor.texts}
            arrows={activeFloor.arrows}
            paths={activeFloor.paths}
            locations={activeFloor.locations}
            selection={selection}
            tool={tool}
            viewport={activeFloor.viewport}
            labelMode={labelMode}
            readOnly={readOnly}
            onSelectionChange={setSelection}
            onViewportChange={onViewportChange}
            onWallAdded={onWallAdded}
            onWallBowChange={onWallBowChange}
            onOutlineEdgeBowChange={onOutlineEdgeBowChange}
            onHoleEdgeBowChange={onHoleEdgeBowChange}
            onLocationAdded={onLocationAdded}
            onTextAdded={onTextAdded}
            onTextEdit={onTextEdit}
            onArrowAdded={onArrowAdded}
            onPathAdded={onPathAdded}
            onSelectionMove={onSelectionMove}
            onCursorMove={onCursorMove}
            onCursorLeave={onCursorLeave}
            remoteCursors={remoteCursors}
            onOutlineCommitted={onOutlineCommitted}
            onHoleCommitted={onHoleCommitted}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-muted/30 text-sm text-muted-foreground">
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

      {/* Inline properties section — sits below the canvas + toolbar
          and scrolls with the page so the editor view is never
          covered by a floating drawer. When something is selected we
          render it; when nothing is selected we hide it to save
          vertical room. */}
      {selection.length > 0 && activeFloor && (
        <section
          ref={propsAnchorRef}
          className="mt-3 rounded-lg border border-border/60 bg-background"
          aria-label="Selected item properties"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <p className="text-sm font-semibold">
              {selection.length > 1
                ? `${selection.length} items selected`
                : selection[0]!.kind === "outline"
                  ? "Floor outline"
                  : selection[0]!.kind === "outline-edge"
                    ? `Edge ${selection[0]!.index + 1}`
                    : selection[0]!.kind === "hole"
                      ? "Floor cutout"
                      : selection[0]!.kind === "hole-edge"
                        ? `Cutout edge ${selection[0]!.index + 1}`
                        : selection[0]!.kind === "wall"
                          ? "Wall"
                          : selection[0]!.kind === "text"
                            ? "Text"
                            : selection[0]!.kind === "arrow"
                              ? "Arrow"
                              : selection[0]!.kind === "path"
                                ? "Path / route"
                                : "Storage location"}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSelection([])}
              aria-label="Clear selection"
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
              texts={activeFloor.texts}
              arrows={activeFloor.arrows}
              paths={activeFloor.paths}
              locations={activeFloor.locations}
              warehouseUuid={warehouseUuid}
              storageTags={storageTags}
              readOnly={readOnly}
              layout="sheet"
              onWallUpdate={onWallUpdate}
              onWallDelete={onWallDelete}
              onOutlineUpdate={onOutlineUpdate}
              onOutlineDelete={onOutlineDelete}
              onHoleUpdate={onHoleUpdate}
              onHoleDelete={onHoleDelete}
              onOutlineEdgeBowChange={onOutlineEdgeBowChange}
              onHoleEdgeBowChange={onHoleEdgeBowChange}
              onTextUpdate={onTextUpdate}
              onTextDelete={onTextDelete}
              onArrowUpdate={onArrowUpdate}
              onArrowDelete={onArrowDelete}
              onPathUpdate={onPathUpdate}
              onPathDelete={onPathDelete}
              onLocationUpdate={onLocationUpdate}
              onLocationDelete={onLocationDelete}
              onSelectionColor={onSelectionColor}
              onDeleteSelected={onDeleteSelected}
            />
          </div>
        </section>
      )}
    </div>
  );
});

/**
 * Display-mode picker for the location labels on the canvas. The
 * default `code` is short + stable but doesn't convey intent; `name`
 * and `tags` let operators flip between the three depending on what
 * they're doing at the moment (designing vs. labelling vs. compliance
 * walk-through). Persisted in localStorage by the parent so the
 * choice survives reloads.
 */
// Hoisted so it's not a fresh array on every parent render — the
// select can then compare stably and skip its own reconciliation.
const LABEL_MODE_OPTIONS: Array<{ value: LocationLabelMode; label: string }> = [
  { value: "code", label: "Code" },
  { value: "name", label: "Name" },
  { value: "tags", label: "Tags" },
];

const LabelModeSelect = memo(function LabelModeSelect({
  value,
  onChange,
}: {
  value: LocationLabelMode;
  onChange: (next: LocationLabelMode) => void;
}) {
  return (
    <label
      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[11px]"
      title="What text to show on each storage area"
    >
      <span className="text-muted-foreground">Label:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as LocationLabelMode)}
        className="rounded-sm bg-background px-1 py-0.5 text-xs font-medium outline-none focus-visible:ring-1"
      >
        {LABEL_MODE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
});

/**
 * Right-click context menu on the canvas. Portal-rendered at screen
 * coords so it can sit above every planner overlay (toolbar, drawer,
 * floor switcher, remote cursors). Closes on Esc, outside click, or
 * any item click.
 *
 * MVP items: Delete + Deselect. Duplicate / bring-forward / send-back
 * land in a follow-up once we plumb per-shape z-order state.
 */
function PlanContextMenu({
  x,
  y,
  selectionCount,
  disabled,
  onClose,
  onDelete,
  onDeselect,
}: {
  x: number;
  y: number;
  selectionCount: number;
  disabled: boolean;
  onClose: () => void;
  onDelete: () => void;
  onDeselect: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // `mousedown` (not `click`) so the outside close fires before any
    // buried Konva shape gets a chance to reselect / open its drawer.
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp to viewport so a right-click near the bottom-right edge
  // doesn't drop the menu off-screen.
  const width = 200;
  const height = 90;
  const left = Math.min(x, window.innerWidth - width - 8);
  const top = Math.min(y, window.innerHeight - height - 8);

  const label =
    selectionCount === 1
      ? "1 item selected"
      : `${selectionCount} items selected`;

  return (
    <div
      ref={ref}
      className="fixed z-[60] min-w-[200px] rounded-md border border-border/60 bg-background p-1 text-xs shadow-xl"
      style={{ left, top }}
      role="menu"
      aria-label="Canvas actions"
    >
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={onDelete}
        disabled={disabled}
        className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span>Delete</span>
        <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          Del
        </kbd>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onDeselect}
        className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left hover:bg-muted"
      >
        <span>Deselect</span>
        <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          Esc
        </kbd>
      </button>
    </div>
  );
}

/**
 * Keyboard cheatsheet — toggled with `?` (or the Keyboard icon in
 * the header). Lists every shortcut the editor honours in one
 * place so operators aren't discovering them by accident.
 *
 * Kept as a plain data-driven table so adding / renaming a
 * shortcut only needs a row edit here, not a separate doc page.
 */
function KeyboardShortcutsOverlay({
  open,
  onOpenChange,
  hasOutline,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  hasOutline: boolean;
}) {
  const groups: Array<{
    title: string;
    rows: Array<{ keys: string[]; label: string; muted?: boolean }>;
  }> = [
    {
      title: "Tools",
      rows: [
        { keys: ["V"], label: "Select" },
        { keys: ["H"], label: "Pan" },
        { keys: ["W"], label: "Wall" },
        { keys: ["F"], label: "Floor outline" },
        {
          keys: ["O"],
          label: "Cut hole",
          muted: !hasOutline,
        },
        { keys: ["L"], label: "Storage location" },
        { keys: ["T"], label: "Text" },
        { keys: ["A"], label: "Arrow" },
        { keys: ["R"], label: "Path / route" },
      ],
    },
    {
      title: "Edit",
      rows: [
        { keys: ["⌘/Ctrl", "Z"], label: "Undo" },
        { keys: ["⌘/Ctrl", "Shift", "Z"], label: "Redo" },
        { keys: ["Delete"], label: "Delete selected" },
        { keys: ["Esc"], label: "Cancel draft / clear selection" },
      ],
    },
    {
      title: "View",
      rows: [
        { keys: ["Shift", "F"], label: "Toggle fullscreen" },
        { keys: ["?"], label: "Show / hide this cheatsheet" },
        {
          keys: ["Scroll"],
          label: "Zoom to cursor (trackpad pinch too)",
        },
        {
          keys: ["Right-click"],
          label: "Context menu on the selected item",
        },
      ],
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Speeds every hand off the toolbar. Available anywhere on the
            planner unless you&apos;re typing into a field.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.title}
              </p>
              <ul className="space-y-1.5 text-xs">
                {g.rows.map((r) => (
                  <li
                    key={r.label}
                    className={cn(
                      "flex items-center justify-between gap-3",
                      r.muted && "opacity-50",
                    )}
                  >
                    <span>{r.label}</span>
                    <span className="flex items-center gap-1">
                      {r.keys.map((k, idx) => (
                        <span key={idx} className="flex items-center gap-1">
                          {idx > 0 && (
                            <span className="text-muted-foreground">+</span>
                          )}
                          <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Autosave status pill — replaces the old "Unsaved changes / Saved"
 * badge + Save button + creator-status badge. Google-Docs style:
 *
 *   • idle / clean              → "All changes saved"
 *   • pending (debouncing)      → "Saving in..."
 *   • saving (in flight)        → spinner + "Saving..."
 *   • saved with lastSavedAt    → "Saved 2s ago" (ticks every 1s)
 *   • error                     → red "Save failed" (detail in banner)
 *   • non-creator + dirty       → amber "{creator} is saving — your
 *                                  changes stay local"
 *   • non-creator + clean       → muted "{creator} is head of room"
 */
function SaveStatusPill({
  status,
  lastSavedAt,
  savedAgoTick: _tick,
  isCreator,
  creatorName,
  hasDirty,
}: {
  status: "idle" | "pending" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
  savedAgoTick: number;
  isCreator: boolean;
  creatorName: string | undefined;
  hasDirty: boolean;
}) {
  // Non-creator surface. They can still edit locally (undo/redo, drag,
  // discard) but nothing persists until the head-of-room hands over.
  if (!isCreator) {
    if (hasDirty && creatorName) {
      return (
        <span
          title="Your edits are local until you become head of room"
          className="inline-flex"
        >
          <Badge tone="amber">
            {creatorName} is saving — local only
          </Badge>
        </span>
      );
    }
    if (creatorName) {
      return <Badge tone="muted">{creatorName} is head of room</Badge>;
    }
    return <Badge tone="muted">View-only</Badge>;
  }

  if (status === "saving") {
    return (
      <Badge tone="muted">
        <Loader2 className="mr-1 size-3 animate-spin" />
        Saving…
      </Badge>
    );
  }
  if (status === "pending") {
    return <Badge tone="amber">Waiting to save…</Badge>;
  }
  if (status === "error") {
    return <Badge tone="amber">Save failed</Badge>;
  }
  if (status === "saved" && lastSavedAt) {
    const seconds = Math.floor((Date.now() - lastSavedAt.getTime()) / 1000);
    const label =
      seconds < 5
        ? "Saved just now"
        : seconds < 60
          ? `Saved ${seconds}s ago`
          : seconds < 3600
            ? `Saved ${Math.floor(seconds / 60)}m ago`
            : `Saved ${Math.floor(seconds / 3600)}h ago`;
    return <Badge tone="muted">{label}</Badge>;
  }
  return <Badge tone="muted">All changes saved</Badge>;
}

/**
 * Required-segregation-areas banner. The warehouse needs at least
 * one cell of each `required_purposes` (quarantine / hold / rejected)
 * before goods-in receive will accept it. Each missing purpose lists
 * the auditor-facing reason so workers know which BRCGS / FSSC clause
 * they're meeting.
 *
 * Layout: chip strip across the top showing every purpose with its
 * current cell count (green when present, red when missing), then a
 * compact reason list under any reds.
 *
 * Memoized so it only re-renders when the readiness snapshot or
 * warehouseName actually change.
 */
const ReadinessBanner = memo(function ReadinessBanner({
  readiness,
  warehouseName,
  canEdit,
}: {
  readiness: WarehouseReadiness;
  warehouseName: string;
  canEdit: boolean;
}) {
  const ready = readiness.ready;
  const counts = readiness.cell_counts_by_purpose;
  const purposes: Array<
    | "regular"
    | "quarantine"
    | "hold"
    | "rejected"
    | "dispatch"
    | "finished_quarantine"
    | "three_pl_storage"
  > = [
    "regular",
    "quarantine",
    "hold",
    "rejected",
    "dispatch",
    "finished_quarantine",
    "three_pl_storage",
  ];

  return (
    <section
      className={
        ready
          ? "rounded-md border border-emerald-300/60 bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30"
          : "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2"
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {ready ? (
          <ShieldCheck className="size-4 text-emerald-600" />
        ) : (
          <AlertTriangle className="size-4 text-destructive" />
        )}
        <span className="font-semibold">
          {ready
            ? `${warehouseName} is ready for goods-in`
            : `${warehouseName} can't accept goods-in yet`}
        </span>
        <span className="ml-auto inline-flex flex-wrap items-center gap-1">
          {purposes.map((p) => {
            const meta = purposeMeta(p);
            const count = counts[p] ?? 0;
            const isMissingRequired =
              count === 0 &&
              (p === "quarantine" ||
                p === "hold" ||
                p === "rejected" ||
                p === "finished_quarantine");
            return (
              <span
                key={p}
                title={`${meta.label}: ${count} cell${count === 1 ? "" : "s"}`}
                className={
                  isMissingRequired
                    ? "inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-background px-1.5 py-0.5 text-[10px] font-semibold text-destructive"
                    : count > 0
                      ? `inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${meta.chipClassName}`
                      : "inline-flex items-center gap-1 rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
                }
              >
                {meta.label} · {count}
              </span>
            );
          })}
        </span>
      </div>

      {!ready && (
        <ul className="mt-2 space-y-1 text-[11px]">
          {readiness.missing_purposes.map((b) => (
            <li
              key={b.purpose}
              className="flex items-start gap-2 rounded-sm border border-destructive/20 bg-background/60 px-2 py-1.5"
            >
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-destructive" />
              <div className="min-w-0 flex-1">
                <span className="font-medium">{b.label}</span>
                <p className="text-muted-foreground">{b.reason}</p>
              </div>
            </li>
          ))}
          {canEdit && (
            <li className="px-2 text-[10px] text-muted-foreground">
              Open any cell on the canvas and set its <em>Purpose</em> to fix
              this — the dialog walks you through it.
            </li>
          )}
        </ul>
      )}
    </section>
  );
});

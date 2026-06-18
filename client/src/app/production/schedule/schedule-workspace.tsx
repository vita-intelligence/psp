"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarDays,
  CalendarRange,
  CalendarSearch,
  ChevronLeft,
  ChevronRight,
  Factory,
  GitBranch,
  Loader2,
  Settings2,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  moveManufacturingOrderStepAction,
  scheduleManufacturingOrderAction,
  scheduleProjectAction,
  shiftManufacturingOrderAction,
  shiftProjectAction,
  unscheduleManufacturingOrderAction,
  unscheduleProjectAction,
} from "@/lib/production/actions";
import { invalidateAudit } from "@/lib/audit/invalidator";
import type { CompanyDefaults } from "@/lib/types";
import type { ProductionScheduleResponse } from "@/lib/production/types";
import { ScheduleBacklog } from "./schedule-backlog";
import {
  DragBoundsContext,
  LivePreviewContext,
  ScheduleEditContext,
  ScheduleScaleContext,
  ZOOM_LABELS,
  ZOOM_LEVELS,
  addDays,
  buildTimeScale,
  fmtRangeLabel,
  isoDate,
  rangeForZoom,
  walkForwardClient,
  type ScheduleEditDispatch,
  type ScheduleEditTarget,
  type ZoomLevel,
} from "./schedule-shared";
import { ScheduleEditDialog } from "./schedule-edit-dialog";
import {
  LABEL_GUTTER_PX,
  MOView,
  rowsFromOps,
  type MORow,
} from "./schedule-view-mo";
import { WorkstationView } from "./schedule-view-workstation";
import {
  ProjectView,
  projectRowsFromOps,
  type ProjectRow,
} from "./schedule-view-project";

interface Site {
  id: number;
  uuid: string;
  name: string;
}

interface Props {
  sites: Site[];
  canEditSteps: boolean;
  company: CompanyDefaults;
}

type ScheduleView = "mo" | "workstation" | "project";

const VIEW_STORAGE_KEY = "production.schedule.view";
const ZOOM_STORAGE_KEY = "production.schedule.zoom";

function readStoredView(): ScheduleView {
  if (typeof window === "undefined") return "mo";
  const v = window.localStorage.getItem(VIEW_STORAGE_KEY);
  if (v === "mo" || v === "workstation" || v === "project") return v;
  return "mo";
}

function readStoredZoom(): ZoomLevel {
  if (typeof window === "undefined") return "week";
  const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY);
  if (raw === "day" || raw === "week" || raw === "month") return raw;
  return "week";
}

export function ScheduleWorkspace({ sites, canEditSteps, company }: Props) {
  const router = useRouter();
  const [siteId, setSiteId] = useState<number>(sites[0]?.id ?? 0);
  const [view, setView] = useState<ScheduleView>("mo");
  const [zoom, setZoom] = useState<ZoomLevel>("week");
  // Anchor date — the workspace snaps it to the appropriate boundary
  // per zoom level (start of day / Monday / 4-week block) when
  // computing the visible range.
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [data, setData] = useState<ProductionScheduleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  // Bounds within which the actively-dragged MO can land without
  // violating chain order. null when nothing is dragged (or the
  // drag has no chain constraints, e.g. a whole-project shift).
  const [dragBounds, setDragBounds] = useState<{
    minStartMs: number;
    maxFinishMs: number | null;
  } | null>(null);
  // Live walker-aware ghost segments for the actively-dragged block.
  // Recomputed on every pointermove during drag so the user sees
  // EXACTLY where the walker will land things before they release.
  const [livePreview, setLivePreview] = useState<{
    rowMatcher: string; // mo uuid or op id for matching the row
    segments: Array<{ startMs: number; finishMs: number }>;
    outsideHoursSeconds: number;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    cursorX: number;
    cursorY: number;
    durationSeconds: number;
    kind: "project" | "mo";
  } | null>(null);
  const [editTarget, setEditTarget] = useState<ScheduleEditTarget | null>(null);
  const [, startTransition] = useTransition();

  // The canvas DOM ref + a live cursor ref let us turn a drag-end
  // event into a calendar drop time. dnd-kit's event object doesn't
  // carry the cursor position by itself, so we track it via a
  // pointermove listener that's only active during drag.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);

  // Restore persisted prefs on mount.
  useEffect(() => {
    setView(readStoredView());
    setZoom(readStoredZoom());
  }, []);

  function chooseView(v: ScheduleView) {
    setView(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    }
  }

  function chooseZoom(z: ZoomLevel) {
    setZoom(z);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ZOOM_STORAGE_KEY, z);
    }
  }

  const { rangeStart, rangeEnd } = useMemo(
    () => rangeForZoom(zoom, anchor),
    [zoom, anchor],
  );

  const scale = useMemo(() => buildTimeScale(zoom, rangeStart), [zoom, rangeStart]);

  const reload = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        warehouse_id: String(siteId),
        from: isoDate(rangeStart),
        to: isoDate(addDays(rangeEnd, -1)),
      }).toString();
      const res = await fetch(`/api/production/schedule?${qs}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setData(null);
        return;
      }
      const body = (await res.json()) as ProductionScheduleResponse;
      setData(body);
    } finally {
      setLoading(false);
    }
  }, [siteId, rangeStart, rangeEnd]);

  useEffect(() => {
    reload();
  }, [reload]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const moRows = useMemo<MORow[]>(
    () => (data ? rowsFromOps(data.operations) : []),
    [data],
  );

  const projectRows = useMemo<ProjectRow[]>(() => {
    if (!data) return [];
    const parentIds = new Map<number, number | null>();
    const meta = new Map<
      number,
      {
        code: string | null;
        uuid: string;
        itemName: string;
        status: string;
        qty: string;
      }
    >();
    for (const op of data.operations) {
      const mo = op.manufacturing_order;
      if (!mo) continue;
      parentIds.set(mo.id, mo.parent_mo_id ?? null);
      meta.set(mo.id, {
        code: mo.code,
        uuid: mo.uuid,
        itemName: mo.item?.name ?? "—",
        status: mo.status,
        qty: mo.quantity,
      });
    }
    return projectRowsFromOps(data.operations, parentIds, meta);
  }, [data]);

  // Flattened, deduped working intervals — used by the client-side
  // walker so the live drag preview matches what the BE will produce
  // on release. Same shape as the WorkingIntervalsContext one inside
  // CalendarShell, computed here so the workspace-level drag handler
  // can use it without crossing the context boundary.
  const workingIntervals = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const out: Array<{ open: Date; close: Date }> = [];
    for (const grp of data.working_windows) {
      for (const day of grp.days) {
        for (const iv of day.intervals) {
          const key = `${iv.open}-${iv.close}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ open: new Date(iv.open), close: new Date(iv.close) });
        }
      }
    }
    return out.sort((a, b) => a.open.getTime() - b.open.getTime());
  }, [data]);

  // Parent-MO map for the whole visible schedule — shared between
  // chain-order validation, drag-bounds computation, and the
  // click-to-edit dialog's project-scope resolution.
  const parentByMo = useMemo(() => {
    const map = new Map<number, number | null>();
    if (!data) return map;
    for (const op of data.operations) {
      const mo = op.manufacturing_order;
      if (!mo) continue;
      map.set(mo.id, mo.parent_mo_id ?? null);
    }
    return map;
  }, [data]);

  // Editor dispatch handed down via context so a block deep in any
  // view can request the dialog without prop-drilling.
  const editDispatch = useMemo<ScheduleEditDispatch>(
    () => ({ openEditor: (t: ScheduleEditTarget) => setEditTarget(t) }),
    [],
  );

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveDragId(id);

    // Seed the cursor from the dnd-kit activator event so the
    // ghost has a real position immediately — without this,
    // ghosts flash at (0, 0) until the first pointermove fires,
    // which the user perceives as the block teleporting to the
    // very left of the viewport.
    const activator = event.activatorEvent as PointerEvent | MouseEvent | undefined;
    const startX =
      activator && "clientX" in activator
        ? activator.clientX
        : cursorRef.current?.x ?? 0;
    const startY =
      activator && "clientY" in activator
        ? activator.clientY
        : cursorRef.current?.y ?? 0;
    cursorRef.current = { x: startX, y: startY };
    const dragStartCursorX = startX;

    // Snapshot of the dragged block's step durations + original
    // first-step-start. The pointermove handler closes over this
    // to recompute walker output on every cursor movement.
    const draggedInfo = (() => {
      if (id.startsWith("op-")) {
        const opId = Number(id.slice("op-".length));
        const op = data?.operations.find((o) => o.id === opId);
        if (!op || !op.planned_start) return null;
        return {
          firstStartMs: new Date(op.planned_start).getTime(),
          stepDurations: [op.planned_duration_seconds ?? 0],
        };
      }
      if (id.startsWith("mo-")) {
        const uuid = id.slice("mo-".length);
        const row = moRows.find((r) => r.moUuid === uuid);
        if (!row) return null;
        return {
          firstStartMs: new Date(row.start).getTime(),
          stepDurations: row.steps
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((s) => s.planned_duration_seconds ?? 0),
        };
      }
      return null;
    })();
    const intervalsForWalker = workingIntervals;
    const pxPerMs = scale.preset.pxPerMs;

    // For backlog drags, prime the preview ghost with the block's
    // duration so it can be drawn at the right width even before
    // the first pointer-move (e.g. if the cursor stays still).
    const activePayload = event.active.data?.current as
      | { kind?: "project" | "mo"; durationSeconds?: number }
      | undefined;
    const kind = id.startsWith("backlog-project-")
      ? "project"
      : id.startsWith("backlog-mo-") || id.startsWith("backlog-op-")
        ? "mo"
        : null;
    if (kind) {
      setDragPreview({
        cursorX: startX,
        cursorY: startY,
        durationSeconds: activePayload?.durationSeconds ?? 0,
        kind,
      });
    }

    function onMove(e: PointerEvent) {
      cursorRef.current = { x: e.clientX, y: e.clientY };
      if (kind) {
        setDragPreview((prev) =>
          prev ? { ...prev, cursorX: e.clientX, cursorY: e.clientY } : prev,
        );
      }

      // Walker-aware live preview for calendar-side drags. Chain
      // walker calls so multi-step MOs show every step's final
      // landing position — matches what the BE will compute on
      // release. cursor.x in viewport pixels → delta_ms via the
      // current zoom's pxPerMs.
      if (draggedInfo && intervalsForWalker.length > 0) {
        const deltaPx = e.clientX - dragStartCursorX;
        const deltaMs = deltaPx / pxPerMs;
        const newFirstStart = draggedInfo.firstStartMs + deltaMs;

        let cursor = newFirstStart;
        let outsideTotal = 0;
        const segments: Array<{ startMs: number; finishMs: number }> = [];
        for (const dur of draggedInfo.stepDurations) {
          const r = walkForwardClient(intervalsForWalker, cursor, dur);
          segments.push({ startMs: r.startAt, finishMs: r.finishAt });
          cursor = r.finishAt;
          outsideTotal += r.outsideHoursSeconds;
        }
        setLivePreview({
          rowMatcher: id,
          segments,
          outsideHoursSeconds: outsideTotal,
        });
      }
    }
    window.addEventListener("pointermove", onMove);
    // Clean up when drag completes — bound here so we don't have to
    // unsubscribe inside handleDragEnd and risk an early return path
    // leaving the listener attached.
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
    };
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);

    // Auto-switch the view to match what's being dragged so the
    // user sees the right row layout when their cursor lands on
    // the canvas. Backlog drags: project → project view, MO → MO
    // view. Calendar-side block drags don't switch.
    if (id.startsWith("backlog-project-") && view !== "project") {
      chooseView("project");
    } else if (id.startsWith("backlog-mo-") && view !== "mo") {
      chooseView("mo");
    } else if (id.startsWith("backlog-op-") && view !== "workstation") {
      // Op-level drag → planner wants to slot it into a station.
      chooseView("workstation");
    }

    // Compute the valid drop window for chain-constrained drags.
    // For project drag (the whole chain shifts together) we don't
    // need bounds — relative order is preserved internally.
    if (
      id.startsWith("mo-") ||
      id.startsWith("op-") ||
      id.startsWith("backlog-mo-") ||
      id.startsWith("backlog-op-")
    ) {
      setDragBounds(computeDragBounds(id));
    } else {
      setDragBounds(null);
    }
  }

  /** Find the [minStart, maxFinish] window the dragged MO must
   *  fit inside. Returns null if neither bound applies (root MO
   *  with no scheduled children). */
  function computeDragBounds(dragId: string): {
    minStartMs: number;
    maxFinishMs: number | null;
  } | null {
    if (!data) return null;

    // Resolve the MO id we're constraining.
    let moId: number | null = null;
    if (dragId.startsWith("mo-")) {
      const uuid = dragId.slice("mo-".length);
      moId = moRows.find((r) => r.moUuid === uuid)?.moId ?? null;
    } else if (dragId.startsWith("op-")) {
      const opId = Number(dragId.slice("op-".length));
      moId =
        data.operations.find((o) => o.id === opId)?.manufacturing_order?.id ??
        null;
    } else if (
      dragId.startsWith("backlog-mo-") ||
      dragId.startsWith("backlog-op-")
    ) {
      const uuid = dragId.startsWith("backlog-op-")
        ? dragId.slice("backlog-op-".length)
        : dragId.slice("backlog-mo-".length);
      const mo = data.backlog.find((b) => b.uuid === uuid);
      moId = mo?.id ?? null;
    }
    if (moId == null) return null;

    // Build parent_mo_id map across BOTH operations and backlog.
    // The visible operations alone won't tell us about a parent
    // whose ops are out of view; the backlog payload includes
    // parent_mo_id for every MO so we can still walk the chain.
    const parentById = new Map<number, number | null>();
    for (const op of data.operations) {
      const mo = op.manufacturing_order;
      if (!mo) continue;
      parentById.set(mo.id, mo.parent_mo_id ?? null);
    }
    for (const b of data.backlog) {
      parentById.set(b.id, b.parent_mo_id ?? null);
    }

    // Walk UP the chain to find the latest "must finish before"
    // start among scheduled ancestors.
    let maxFinishMs: number | null = null;
    {
      const seen = new Set<number>();
      let cur = parentById.get(moId) ?? null;
      while (cur != null && !seen.has(cur)) {
        seen.add(cur);
        const ancestorOps = data.operations.filter(
          (o) => o.manufacturing_order?.id === cur && o.planned_start,
        );
        if (ancestorOps.length > 0) {
          const start = Math.min(
            ...ancestorOps.map((o) => new Date(o.planned_start!).getTime()),
          );
          // The tightest (earliest) ancestor start wins.
          maxFinishMs = maxFinishMs == null ? start : Math.min(maxFinishMs, start);
        }
        cur = parentById.get(cur) ?? null;
      }
    }

    // Walk DOWN the chain (BFS) for scheduled descendants — find
    // the latest finish; we must START after that.
    let minStartMs = Date.now();
    {
      const childrenByMo = new Map<number, number[]>();
      for (const [child, parent] of parentById) {
        if (parent == null) continue;
        const arr = childrenByMo.get(parent) ?? [];
        arr.push(child);
        childrenByMo.set(parent, arr);
      }
      const queue = [...(childrenByMo.get(moId) ?? [])];
      const seen = new Set<number>();
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const descOps = data.operations.filter(
          (o) => o.manufacturing_order?.id === id && o.planned_finish,
        );
        if (descOps.length > 0) {
          const finish = Math.max(
            ...descOps.map((o) => new Date(o.planned_finish!).getTime()),
          );
          minStartMs = Math.max(minStartMs, finish);
        }
        for (const c of childrenByMo.get(id) ?? []) queue.push(c);
      }
    }

    return { minStartMs, maxFinishMs };
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    setDragPreview(null);
    setDragBounds(null);
    setLivePreview(null);
    if (!canEditSteps || !data) return;
    const { active, delta, over } = event;
    const idStr = String(active.id);
    const overId = over ? String(over.id) : null;

    // ----- Canvas → backlog rail: unschedule the MO/project.
    if (overId === "backlog-zone") {
      if (idStr.startsWith("mo-")) {
        const uuid = idStr.slice("mo-".length);
        startTransition(async () => {
          const res = await unscheduleManufacturingOrderAction(uuid);
          if (res.ok) {
            toast.success("Returned to backlog");
            invalidateAudit("manufacturing_order", res.mo.id);
            router.refresh();
            await reload();
          } else {
            toast.error(res.detail);
          }
        });
        return;
      }
      if (idStr.startsWith("project-")) {
        const uuid = idStr.slice("project-".length);
        startTransition(async () => {
          const res = await unscheduleProjectAction(uuid);
          if (res.ok) {
            toast.success("Project returned to backlog");
            invalidateAudit("manufacturing_order", res.mo.id);
            router.refresh();
            await reload();
          } else {
            toast.error(res.detail);
          }
        });
        return;
      }
      if (idStr.startsWith("op-")) {
        const opId = Number(idStr.slice("op-".length));
        const op = data.operations.find((o) => o.id === opId);
        const moUuid = op?.manufacturing_order?.uuid;
        if (!moUuid) return;
        startTransition(async () => {
          const res = await unscheduleManufacturingOrderAction(moUuid);
          if (res.ok) {
            toast.success("Returned to backlog");
            invalidateAudit("manufacturing_order", res.mo.id);
            router.refresh();
            await reload();
          } else {
            toast.error(res.detail);
          }
        });
        return;
      }
      // Backlog item dropped back on itself — no-op.
      return;
    }

    // ----- Backlog → canvas: schedule the MO or project at the
    // drop point. If the drop landed on a specific WSG row (in
    // workstation view), pin the MO's first step to that station.
    // `backlog-op-<uuid>` comes from dragging an individual op row
    // inside the expanded backlog — same payload, same handler.
    if (
      idStr.startsWith("backlog-project-") ||
      idStr.startsWith("backlog-mo-") ||
      idStr.startsWith("backlog-op-")
    ) {
      const isProject = idStr.startsWith("backlog-project-");
      const uuid = isProject
        ? idStr.slice("backlog-project-".length)
        : idStr.startsWith("backlog-op-")
          ? idStr.slice("backlog-op-".length)
          : idStr.slice("backlog-mo-".length);

      const dropTime = cursorToScheduleTime();
      if (!dropTime) {
        toast.error("Drop the MO onto the calendar area.");
        return;
      }

      // Past-time guard — don't bother the server.
      if (isPast(dropTime)) {
        toast.error("Can't schedule before the current time.");
        return;
      }

      // Out-of-hours warning fires regardless of whether the BE
      // ends up relocating the block.
      warnIfDropOutsideHours(dropTime);

      // Workstation view drop on a WSG row → schedule + pin first
      // step to that WSG. Project drag ignores WSG (children get
      // their routing-defined stations).
      const wsgId =
        !isProject && overId && overId.startsWith("wsg-")
          ? Number(overId.slice("wsg-".length))
          : undefined;

      startTransition(async () => {
        const res = isProject
          ? await scheduleProjectAction(uuid, dropTime.toISOString())
          : await scheduleManufacturingOrderAction(
              uuid,
              dropTime.toISOString(),
              wsgId !== undefined
                ? { workstationGroupId: wsgId }
                : undefined,
            );
        if (res.ok) {
          toast.success(isProject ? "Project scheduled" : "Scheduled");
          warnIfOutsideHours(res.outsideHoursSeconds ?? 0);
          invalidateAudit("manufacturing_order", res.mo.id);
          router.refresh();
          await reload();
        } else {
          toast.error(res.detail);
          await reload();
        }
      });
      return;
    }

    // Pixels → milliseconds via the active zoom level.
    const msDelta = Math.round(delta.x / scale.preset.pxPerMs);
    const secondsDelta = Math.round(msDelta / 1000);

    if (idStr.startsWith("mo-")) {
      const uuid = idStr.slice("mo-".length);
      const row = moRows.find((r) => r.moUuid === uuid);
      if (!row || secondsDelta === 0) return;

      // Past-time guard — earliest step's new start can't be < now.
      const newFirstStart = new Date(
        new Date(row.start).getTime() + msDelta,
      );
      if (isPast(newFirstStart)) {
        toast.error("Can't drag the block before the current time.");
        return;
      }
      // Chain-order guard — block dragging a child past its parent's
      // start (or vice versa) before we even fire the request so the
      // user never sees the optimistic move bounce back.
      const newLastMs = new Date(row.finish).getTime() + msDelta;
      const chainErr = validateChainOrder(
        row.moId,
        newFirstStart.getTime(),
        newLastMs,
      );
      if (chainErr) {
        toast.error(chainErr);
        return;
      }
      warnIfDropOutsideHours(newFirstStart);

      const snapshot = data;
      // Optimistic: shift every op belonging to this MO by msDelta
      // so the block visually lands at the drop point with no wait.
      setData((cur) =>
        cur ? shiftOpsForMOs(cur, new Set([uuid]), msDelta) : cur,
      );

      startTransition(async () => {
        const res = await shiftManufacturingOrderAction(uuid, secondsDelta);
        if (res.ok) {
          toast.success("Schedule updated");
          invalidateAudit("manufacturing_order", row.moId);
          router.refresh();
          // Light sync from server (in case BE clamped to working
          // hours or anything else our naive shift didn't predict).
          await reload();
        } else {
          setData(snapshot);
          toast.error(res.detail);
        }
      });
      return;
    }

    if (idStr.startsWith("project-")) {
      const uuid = idStr.slice("project-".length);
      const row = projectRows.find((r) => r.rootMoUuid === uuid);
      if (!row || secondsDelta === 0) return;

      // Earliest step in the WHOLE chain after the shift.
      const newFirstStart = new Date(
        new Date(row.start).getTime() + msDelta,
      );
      if (isPast(newFirstStart)) {
        toast.error("Can't drag the project before the current time.");
        return;
      }
      warnIfDropOutsideHours(newFirstStart);

      const snapshot = data;
      // Build the set of MO UUIDs in this project (from the same
      // root-walking the project view uses) and shift them all.
      const chainUuids = chainUuidsForRoot(data, row.rootMoId);
      setData((cur) =>
        cur ? shiftOpsForMOs(cur, chainUuids, msDelta) : cur,
      );

      startTransition(async () => {
        const res = await shiftProjectAction(uuid, secondsDelta);
        if (res.ok) {
          toast.success("Project rescheduled");
          invalidateAudit("manufacturing_order", row.rootMoId);
          router.refresh();
          await reload();
        } else {
          setData(snapshot);
          toast.error(res.detail);
        }
      });
      return;
    }

    if (idStr.startsWith("op-")) {
      const opId = Number(idStr.slice("op-".length));
      const op = data.operations.find((o) => o.id === opId);
      if (!op || !op.planned_start || !op.planned_finish) return;
      const newStartDate = new Date(
        new Date(op.planned_start).getTime() + msDelta,
      );
      if (isPast(newStartDate)) {
        toast.error("Can't drag the operation before the current time.");
        return;
      }
      const newFinishDate = new Date(
        new Date(op.planned_finish).getTime() + msDelta,
      );
      // Chain-order guard at the MO level — a single op shift moves
      // the whole MO's bounds out of sync if it crosses a parent /
      // child boundary.
      const moBounds = (() => {
        if (!op.manufacturing_order) return null;
        const moId = op.manufacturing_order.id;
        const sibs = data.operations.filter(
          (o) =>
            o.manufacturing_order?.id === moId &&
            o.id !== opId &&
            o.planned_start &&
            o.planned_finish,
        );
        const starts = sibs.map((o) => new Date(o.planned_start!).getTime());
        const finishes = sibs.map((o) => new Date(o.planned_finish!).getTime());
        starts.push(newStartDate.getTime());
        finishes.push(newFinishDate.getTime());
        return {
          moId,
          first: Math.min(...starts),
          last: Math.max(...finishes),
        };
      })();
      if (moBounds) {
        const chainErr = validateChainOrder(
          moBounds.moId,
          moBounds.first,
          moBounds.last,
        );
        if (chainErr) {
          toast.error(chainErr);
          return;
        }
      }
      warnIfDropOutsideHours(newStartDate);
      const newStart = newStartDate.toISOString();
      const newFinish = newFinishDate.toISOString();

      let newWsgId = op.workstation_group_id;
      if (over) {
        const overId = String(over.id);
        if (overId.startsWith("wsg-")) {
          newWsgId = Number(overId.slice("wsg-".length));
        }
      }

      const moUuid = op.manufacturing_order?.uuid;
      if (!moUuid) return;

      const snapshot = data;
      // Optimistic: update this one op in place. Server runs the
      // walker so the actual final position may shift forward into
      // the next working window if the drop landed in closed time —
      // the reload() below pulls in those walker-adjusted times.
      setData((cur) =>
        cur
          ? {
              ...cur,
              operations: cur.operations.map((o) =>
                o.id === opId
                  ? {
                      ...o,
                      planned_start: newStart,
                      planned_finish: newFinish,
                      workstation_group_id: newWsgId,
                    }
                  : o,
              ),
            }
          : cur,
      );

      startTransition(async () => {
        const res = await moveManufacturingOrderStepAction(
          moUuid,
          op.uuid,
          newStart,
          newWsgId !== op.workstation_group_id && newWsgId != null
            ? { workstationGroupId: newWsgId }
            : undefined,
        );
        if (res.ok) {
          toast.success("Operation updated");
          warnIfOutsideHours(res.outsideHoursSeconds ?? 0);
          invalidateAudit("manufacturing_order_step", op.id);
          router.refresh();
          await reload();
        } else {
          setData(snapshot);
          toast.error(res.detail);
        }
      });
    }
  }

  // Turn the last-known cursor position into a calendar time. Returns
  // null if the cursor never entered the canvas (drop landed back on
  // the backlog or somewhere off-screen).
  // Fire a warning toast when the BE reports the placed block
  // spilled past available working windows. Lets the planner
  // know "yes it's scheduled, but you're booking off-shift time"
  // without blocking the drop (sometimes you really do need it).
  function warnIfOutsideHours(seconds: number) {
    if (seconds <= 0) return;
    const hours = Math.round(seconds / 360) / 10;
    toast.warning(
      `Schedule includes ${hours}h outside working hours. Check the calendar before committing.`,
    );
  }

  // True if `time` lands inside ANY working window in the response
  // (we use the union across WSGs since most factories share
  // warehouse hours — the BE walker does the same).
  function isInsideWorkingHours(time: Date): boolean {
    if (!data) return true;
    const ms = time.getTime();
    for (const grp of data.working_windows) {
      for (const day of grp.days) {
        for (const iv of day.intervals) {
          const open = new Date(iv.open).getTime();
          const close = new Date(iv.close).getTime();
          if (ms >= open && ms < close) return true;
        }
      }
    }
    return false;
  }

  // Frontend pre-flight: don't even fire the request if the
  // requested time is in the past. BE rejects too, but a toast
  // before the round-trip is friendlier (no optimistic flash).
  function isPast(time: Date): boolean {
    return time.getTime() < Date.now();
  }

  function warnIfDropOutsideHours(time: Date) {
    if (!isInsideWorkingHours(time)) {
      toast.warning(
        "Drop time is outside working hours. The schedule walker will move the block to the next available window.",
      );
    }
  }

  // Walk parent_mo_id ancestors of `moId` (transitive) and the
  // direct + indirect descendants to ensure the new placement
  // doesn't break chain ordering. Returns a human-readable error
  // string if a violation would happen, null if the move is OK.
  // Mirrors the backend guards so the user gets instant feedback
  // — no optimistic flicker before the BE rejects.
  function validateChainOrder(
    moId: number,
    newFirstMs: number,
    newLastMs: number,
  ): string | null {
    if (!data) return null;
    // Build a per-MO summary from the visible operations.
    const parentByMo = new Map<number, number | null>();
    const codeByMo = new Map<number, string | null>();
    const firstStartByMo = new Map<number, number>();
    const lastFinishByMo = new Map<number, number>();
    for (const op of data.operations) {
      const mo = op.manufacturing_order;
      if (!mo || !op.planned_start || !op.planned_finish) continue;
      parentByMo.set(mo.id, mo.parent_mo_id ?? null);
      codeByMo.set(mo.id, mo.code);
      const s = new Date(op.planned_start).getTime();
      const f = new Date(op.planned_finish).getTime();
      const curFirst = firstStartByMo.get(mo.id);
      const curLast = lastFinishByMo.get(mo.id);
      if (curFirst === undefined || s < curFirst) firstStartByMo.set(mo.id, s);
      if (curLast === undefined || f > curLast) lastFinishByMo.set(mo.id, f);
    }

    // 1) Must finish before every scheduled ancestor starts.
    let cur = parentByMo.get(moId) ?? null;
    const seenUp = new Set<number>();
    while (cur != null && !seenUp.has(cur)) {
      seenUp.add(cur);
      const ancestorStart = firstStartByMo.get(cur);
      if (ancestorStart !== undefined && newLastMs > ancestorStart) {
        return `This MO must finish before ${codeByMo.get(cur) ?? `MO #${cur}`} starts.`;
      }
      cur = parentByMo.get(cur) ?? null;
    }

    // 2) Must start after every scheduled descendant finishes.
    // BFS through descendants via reverse-lookup on parent map.
    const childrenByMo = new Map<number, number[]>();
    for (const [child, parent] of parentByMo) {
      if (parent == null) continue;
      const arr = childrenByMo.get(parent) ?? [];
      arr.push(child);
      childrenByMo.set(parent, arr);
    }
    const queue: number[] = [...(childrenByMo.get(moId) ?? [])];
    const seenDown = new Set<number>();
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seenDown.has(id)) continue;
      seenDown.add(id);
      const descLast = lastFinishByMo.get(id);
      if (descLast !== undefined && descLast > newFirstMs) {
        return `This MO must start after ${codeByMo.get(id) ?? `MO #${id}`} finishes — that sub-MO feeds this one.`;
      }
      for (const grand of childrenByMo.get(id) ?? []) queue.push(grand);
    }
    return null;
  }

  function cursorToScheduleTime(): Date | null {
    const cursor = cursorRef.current;
    const canvas = canvasRef.current;
    if (!cursor || !canvas) return null;

    // The CalendarShell renders its own inner scroll container
    // (data-schedule-scroll). Use THAT element for scrollLeft +
    // bounding rect — the outer canvas wrapper doesn't scroll
    // and would return scrollLeft=0, throwing the math off.
    const scrollEl =
      (canvas.querySelector("[data-schedule-scroll]") as HTMLElement | null) ??
      canvas;

    const rect = scrollEl.getBoundingClientRect();
    // Cursor → scrolled-content-x → time-axis-x. Subtract the
    // label gutter because the time axis only starts AFTER it.
    const contentX = cursor.x - rect.left + scrollEl.scrollLeft;
    const timeAxisX = contentX - LABEL_GUTTER_PX;
    if (timeAxisX < 0) return null;
    const ms = timeAxisX / scale.preset.pxPerMs;
    return new Date(scale.rangeStart.getTime() + ms);
  }

  // Navigation step depends on the zoom — prev/next moves by the
  // range's width so the next page shows the next 1/7/28 days.
  function stepRange(direction: -1 | 1) {
    const days = direction * scale.preset.rangeDays;
    setAnchor((a) => addDays(a, days));
  }

  function goToday() {
    setAnchor(new Date());
  }

  return (
    <DndContext
      sensors={sensors}
      // Pointer-based collision detection — the droppable the
      // cursor is currently inside wins. Better than the default
      // rectIntersection for this calendar because blocks can be
      // partially clipped by the scroll container yet still
      // visually under the cursor; rectIntersection picks based on
      // un-clipped bounding boxes and can mis-target a wsg row when
      // the user wants the backlog.
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      // Disable dnd-kit's auto-scroll: combined with the canvas's
      // own overflow it jerks the dragged block's transform
      // mid-drag, which looks like the block teleporting off-cursor.
      autoScroll={false}
    >
      <ScheduleScaleContext.Provider value={scale}>
        <DragBoundsContext.Provider value={dragBounds}>
        <LivePreviewContext.Provider value={livePreview}>
        <ScheduleEditContext.Provider value={editDispatch}>
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Sticky control bar */}
          <div className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-border/60 bg-card px-3 py-2 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">
                Site
              </span>
              <Select
                value={String(siteId)}
                onValueChange={(v) => setSiteId(Number(v))}
              >
                <SelectTrigger className="h-8 w-[14rem] text-xs">
                  <SelectValue placeholder="Pick a site" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ViewPicker view={view} onChange={chooseView} />
            <ZoomPicker zoom={zoom} onChange={chooseZoom} />

            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => stepRange(-1)}
                aria-label="Previous range"
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={goToday}
              >
                Today
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => stepRange(1)}
                aria-label="Next range"
              >
                <ChevronRight className="size-3.5" />
              </Button>
              <span className="ml-3 text-xs font-medium text-foreground">
                {fmtRangeLabel(scale)}
              </span>
              {loading && (
                <Loader2 className="ml-2 size-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Body: backlog rail + scrollable canvas */}
          <div className="flex min-h-0 flex-1">
            <ScheduleBacklog
              items={data?.backlog ?? []}
              canEdit={canEditSteps}
              company={company}
            />

            <CanvasArea
              canvasRef={canvasRef}
              activeDragId={activeDragId}
            >
              {!data ? (
                <div className="m-6 rounded-md border border-border/60 bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                  {loading ? "Loading…" : "No data yet."}
                </div>
              ) : (
                <div className="relative flex flex-1 flex-col p-2">
                  {/* Always render the view's grid — even with zero
                      rows the day axis + spacer cells are present so
                      the user has a real drop target during drag and
                      can see the time position before they let go. */}
                  {view === "mo" && (
                    <MOView
                      data={data}
                      rows={moRows}
                      canEditSteps={canEditSteps}
                    />
                  )}
                  {view === "workstation" &&
                    (data.workstation_groups.length === 0 ? (
                      <CanvasEmpty message="No workstation groups configured." />
                    ) : (
                      <WorkstationView
                        data={data}
                        canEditSteps={canEditSteps}
                      />
                    ))}
                  {view === "project" && (
                    <ProjectView
                      data={data}
                      rows={projectRows}
                      canEditSteps={canEditSteps}
                    />
                  )}

                  {/* Hint overlay when the active view has nothing
                      scheduled — sits above the empty grid so the
                      time axis stays visible behind it. */}
                  {view === "mo" && moRows.length === 0 && (
                    <DropHintOverlay
                      message={
                        activeDragId?.startsWith("backlog-")
                          ? "Drop anywhere on the time axis to schedule."
                          : "Drag an approved MO from the backlog onto the calendar."
                      }
                    />
                  )}
                  {view === "project" && projectRows.length === 0 && (
                    <DropHintOverlay
                      message={
                        activeDragId?.startsWith("backlog-")
                          ? "Drop anywhere on the time axis to schedule the project."
                          : "Drag a project from the backlog onto the calendar."
                      }
                    />
                  )}
                </div>
              )}
            </CanvasArea>
          </div>

          {dragPreview && (
            <DragPreviewGhost
              cursorX={dragPreview.cursorX}
              cursorY={dragPreview.cursorY}
              durationSeconds={dragPreview.durationSeconds}
              kind={dragPreview.kind}
              scale={scale}
              canvasRef={canvasRef}
            />
          )}
        </div>
        <ScheduleEditDialog
          target={editTarget}
          data={data}
          workingIntervals={workingIntervals}
          parentByMo={parentByMo}
          company={company}
          canEdit={canEditSteps}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            void reload();
          }}
        />
        </ScheduleEditContext.Provider>
        </LivePreviewContext.Provider>
        </DragBoundsContext.Provider>
      </ScheduleScaleContext.Provider>
    </DndContext>
  );
}

/** Canvas wrapper — the brand-color glow during backlog drags is
 *  driven entirely by `activeDragId`, not by useDroppable. We
 *  deliberately do NOT make the canvas a dnd-kit droppable: when
 *  combined with `overflow-auto`, dnd-kit's auto-scroll kicks in
 *  during drag and jerks the transform of any block being moved,
 *  which the user sees as the block teleporting off the cursor.
 *  Drop coordinates are computed from cursor position regardless,
 *  so no droppable is needed. */
function CanvasArea({
  canvasRef,
  activeDragId,
  children,
}: {
  canvasRef: React.MutableRefObject<HTMLDivElement | null>;
  activeDragId: string | null;
  children: React.ReactNode;
}) {
  const isBacklogDrag = activeDragId?.startsWith("backlog-") ?? false;

  return (
    <div
      ref={canvasRef}
      className={cn(
        // No overflow on this wrapper — the CalendarShell owns the
        // scroll container inside. Nested overflow ancestors clip
        // dragged blocks twice and confuse the drop detection.
        "flex min-h-0 min-w-0 flex-1 flex-col bg-background transition-shadow",
        isBacklogDrag &&
          "shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--color-brand)_45%,transparent)]",
      )}
    >
      {children}
    </div>
  );
}

/** Return a new ProductionScheduleResponse with every operation
 *  whose MO uuid is in `moUuids` shifted by `msDelta` milliseconds.
 *  Used to drive the optimistic update — the BE applies the exact
 *  same shift, so a clean refetch afterwards is a no-op. */
function shiftOpsForMOs(
  data: ProductionScheduleResponse,
  moUuids: Set<string>,
  msDelta: number,
): ProductionScheduleResponse {
  return {
    ...data,
    operations: data.operations.map((op) => {
      const uuid = op.manufacturing_order?.uuid;
      if (!uuid || !moUuids.has(uuid)) return op;
      return {
        ...op,
        planned_start: op.planned_start
          ? new Date(new Date(op.planned_start).getTime() + msDelta).toISOString()
          : null,
        planned_finish: op.planned_finish
          ? new Date(new Date(op.planned_finish).getTime() + msDelta).toISOString()
          : null,
      };
    }),
  };
}

/** Walk `data.operations` to find every MO uuid whose chain root
 *  (via parent_mo_id) is `rootMoId`. Used for optimistic project
 *  shifts so we know which ops to move together. Mirrors the
 *  rootOf walk in projectRowsFromOps. */
function chainUuidsForRoot(
  data: ProductionScheduleResponse,
  rootMoId: number,
): Set<string> {
  const parentIds = new Map<number, number | null>();
  const uuidById = new Map<number, string>();
  for (const op of data.operations) {
    const mo = op.manufacturing_order;
    if (!mo) continue;
    parentIds.set(mo.id, mo.parent_mo_id ?? null);
    uuidById.set(mo.id, mo.uuid);
  }

  function rootOf(moId: number): number {
    let cur = moId;
    const seen = new Set<number>();
    while (true) {
      if (seen.has(cur)) return cur;
      seen.add(cur);
      const pid = parentIds.get(cur);
      if (pid == null) return cur;
      // Parent isn't in this slice of operations — treat current
      // as visible root. Matches projectRowsFromOps in
      // schedule-view-project.tsx so optimistic shift targets the
      // same MOs the project view shows.
      if (!parentIds.has(pid)) return cur;
      cur = pid;
    }
  }

  const out = new Set<string>();
  for (const [moId, uuid] of uuidById) {
    if (rootOf(moId) === rootMoId) out.add(uuid);
  }
  return out;
}

/** Ghost preview that follows the cursor while a backlog item is
 *  being dragged. Shows the block at its real width (durationSeconds
 *  × scale.pxPerMs) anchored to the cursor's clientX so the planner
 *  can see exactly which time-axis position they're targeting. Fixed
 *  positioning so it floats above the calendar without interfering
 *  with the canvas scroll. */
function DragPreviewGhost({
  cursorX,
  cursorY,
  durationSeconds,
  kind,
  scale,
  canvasRef,
}: {
  cursorX: number;
  cursorY: number;
  durationSeconds: number;
  kind: "project" | "mo";
  scale: ReturnType<typeof buildTimeScale>;
  canvasRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  // Don't render until we have a real cursor — otherwise the ghost
  // appears glued to the top-left of the viewport for one frame
  // before the first pointer-move event lands.
  if (cursorX <= 0 || cursorY <= 0) return null;

  const widthPx = Math.max(durationSeconds * scale.preset.pxPerMs, 24);
  const heightPx = 44;

  // Compute the proposed drop time so we can label the ghost with
  // something readable ("Mon · 14:30") — same math as
  // cursorToScheduleTime() in the workspace.
  let timeLabel = "";
  const canvas = canvasRef.current;
  if (canvas) {
    const rect = canvas.getBoundingClientRect();
    if (cursorX >= rect.left && cursorX <= rect.right) {
      const localX = cursorX - rect.left + canvas.scrollLeft;
      const ms = localX / scale.preset.pxPerMs;
      const dt = new Date(scale.rangeStart.getTime() + ms);
      timeLabel = dt.toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }

  return (
    <div
      className={cn(
        "pointer-events-none fixed z-[100] rounded-md border-2 border-dashed shadow-lg",
        kind === "project"
          ? "border-indigo-500 bg-indigo-100/60"
          : "border-brand bg-brand/15",
      )}
      style={{
        left: cursorX,
        top: cursorY - heightPx / 2,
        width: widthPx,
        height: heightPx,
      }}
    >
      <div className="flex h-full items-center justify-between gap-2 px-2 text-[10px] font-semibold">
        <span
          className={cn(
            "truncate uppercase tracking-wide",
            kind === "project" ? "text-indigo-700" : "text-brand",
          )}
        >
          {kind === "project" ? "Project" : "MO"}
        </span>
        {timeLabel && (
          <span className="shrink-0 rounded bg-card px-1 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
            {timeLabel}
          </span>
        )}
      </div>
    </div>
  );
}

/** Floating hint banner shown when the current view has no rows.
 *  Sits inside the canvas's `relative` wrapper so it stays
 *  centered over the empty grid without blocking drop events. */
function DropHintOverlay({ message }: { message: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center">
      <div className="max-w-md rounded-md border border-dashed border-border/70 bg-card/90 px-4 py-2 text-center text-xs text-muted-foreground shadow-sm backdrop-blur">
        {message}
      </div>
    </div>
  );
}

function CanvasEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function ViewPicker({
  view,
  onChange,
}: {
  view: ScheduleView;
  onChange: (v: ScheduleView) => void;
}) {
  const options: { id: ScheduleView; label: string; icon: typeof Factory }[] = [
    { id: "mo", label: "By MO", icon: Factory },
    { id: "workstation", label: "By workstation", icon: Settings2 },
    { id: "project", label: "By project", icon: GitBranch },
  ];

  return (
    <div className="inline-flex items-center rounded-md border border-border/60 p-0.5">
      {options.map((o) => {
        const Icon = o.icon;
        const active = view === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ZoomPicker({
  zoom,
  onChange,
}: {
  zoom: ZoomLevel;
  onChange: (z: ZoomLevel) => void;
}) {
  const icons: Record<ZoomLevel, typeof CalendarDays> = {
    day: CalendarSearch,
    week: CalendarDays,
    month: CalendarRange,
  };

  return (
    <div className="inline-flex items-center rounded-md border border-border/60 p-0.5">
      {ZOOM_LEVELS.map((z) => {
        const Icon = icons[z];
        const active = z === zoom;
        return (
          <button
            key={z}
            type="button"
            onClick={() => onChange(z)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {ZOOM_LABELS[z]}
          </button>
        );
      })}
    </div>
  );
}

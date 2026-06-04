"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Stage, Layer, Rect, Line, Group, Text, Shape, Circle } from "react-konva";
import type Konva from "konva";
import { cn } from "@/lib/utils";
import {
  GRID_MAJOR_CM,
  GRID_MINOR_CM,
  SNAP_THRESHOLD_PX,
  collectSnapTargets,
  edgeBowHandle,
  edgeChordMidpoint,
  edgeControlPoint,
  findClosestSnap,
  isSelected,
  itemsInMarquee,
  mergeSelections,
  normaliseRect,
  projectEdgeBow,
  projectEdgeHandleAxis,
  snapCm,
  snapPoint,
  toggleSelection,
} from "./plan-utils";
import type {
  FloorOutline,
  Hole,
  LocalLocation,
  Point,
  SelectionItem,
  SelectionSet,
  ToolMode,
  Viewport,
  Wall,
} from "./plan-types";

interface PlanCanvasProps {
  outline: FloorOutline | undefined;
  walls: Wall[];
  locations: LocalLocation[];
  selection: SelectionSet;
  tool: ToolMode;
  viewport: Viewport;
  /** Whether the canvas is in read-only mode (viewer permissions). */
  readOnly: boolean;
  /** Canvas height in CSS pixels — the parent picks this so the
   *  mobile layout can use most of the viewport while desktop stays
   *  at a fixed height. */
  heightPx: number;
  onSelectionChange: (next: SelectionSet) => void;
  onViewportChange: (next: Viewport) => void;
  onWallAdded: (wall: Wall) => void;
  onWallBowChange: (id: string, bow: number) => void;
  /** Commit a new bow value (cm sagitta) for a single outline edge.
   *  Snapshotted by the parent so each curve change is one undo step. */
  onOutlineEdgeBowChange: (index: number, bow: number) => void;
  /** Same as `onOutlineEdgeBowChange` but for a specific hole's edge. */
  onHoleEdgeBowChange: (holeId: string, index: number, bow: number) => void;
  onLocationAdded: (location: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  /** Translate every selected item by (dx, dy) cm in one snapshot.
   *  Fires once on drag end for the wall / location the user grabbed;
   *  the parent applies the delta to every selected item so a group
   *  drag is a single undo step. dx/dy are already snapped to 50cm.
   *  For a single-selected item this collapses to a normal move. */
  onSelectionMove: (dx: number, dy: number) => void;
  onOutlineCommitted: (points: Point[]) => void;
  onHoleCommitted: (points: Point[]) => void;
}

export interface PlanCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  /** Cancel any in-progress polygon draw. Bound to Esc. */
  cancelDraft: () => void;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
const DEFAULT_LOCATION_CM = 100; // 1m × 1m default tile
const MIN_MARQUEE_PX = 4;        // smaller than this = treat as a plain click

type Draft =
  | { kind: "wall"; x1: number; y1: number; x2: number; y2: number }
  | {
      kind: "location";
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      kind: "marquee";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      /** Shift / Ctrl / Cmd was held — add to existing selection on
       *  finish instead of replacing. */
      additive: boolean;
    }
  | { kind: "outline"; points: Point[] }
  | { kind: "hole"; points: Point[] };

/**
 * The Konva canvas itself. Renders the floor outline, walls, and
 * storage locations + handles pan, zoom, draw, and select
 * interactions. Pure presentational — the parent owns state and gets
 * called back on every interaction.
 *
 * Layers (back to front):
 *   1. Grid               — purely decorative, not interactive
 *   2. Floor outline      — filled polygon with hole cutouts (evenodd)
 *   3. Walls              — thick lines on top of the floor
 *   4. Storage locations  — bordered rects with code / name labels
 *   5. Overlays           — in-progress draft + snap indicator
 *
 * Touch support: pinch-zoom on two-finger gesture, single-finger
 * drag pans when in pan mode (or anywhere when no tool active).
 */
export const PlanCanvas = forwardRef<PlanCanvasHandle, PlanCanvasProps>(
  function PlanCanvas(
    {
      outline,
      walls,
      locations,
      selection,
      tool,
      viewport,
      readOnly,
      heightPx,
      onSelectionChange,
      onViewportChange,
      onWallAdded,
      onWallBowChange,
      onOutlineEdgeBowChange,
      onHoleEdgeBowChange,
      onLocationAdded,
      onSelectionMove,
      onOutlineCommitted,
      onHoleCommitted,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const stageRef = useRef<Konva.Stage | null>(null);
    const [size, setSize] = useState({ width: 800, height: heightPx });

    const [draft, setDraft] = useState<Draft | null>(null);
    const [snapIndicator, setSnapIndicator] = useState<Point | null>(null);

    // Snap targets recomputed when geometry changes. Cheap (handful
    // of points), but useMemo means event handlers don't rebuild.
    const snapTargets = useMemo(
      () => collectSnapTargets(walls, outline),
      [walls, outline],
    );

    /** Pick the right behaviour for a shape click: shift / ctrl /
     *  cmd toggles, anything else replaces. Centralised here so every
     *  shape's onClick uses the same rule. */
    const selectItem = useCallback(
      (
        item: SelectionItem,
        e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
      ) => {
        if (isAdditiveEvent(e)) {
          onSelectionChange(toggleSelection(selection, item));
        } else {
          onSelectionChange([item]);
        }
      },
      [onSelectionChange, selection],
    );

    useImperativeHandle(
      ref,
      () => ({
        zoomIn: () => zoomBy(1.2),
        zoomOut: () => zoomBy(1 / 1.2),
        resetView: () => onViewportChange({ x: 0, y: 0, scale: 0.4 }),
        cancelDraft: () => {
          setDraft(null);
          setSnapIndicator(null);
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [viewport.scale, size.width, size.height],
    );

    // Drop the draft whenever the tool changes so half-drawn
    // outlines / holes don't bleed into a different mode.
    useEffect(() => {
      setDraft(null);
      setSnapIndicator(null);
    }, [tool]);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const update = () => {
        const rect = el.getBoundingClientRect();
        setSize({
          width: Math.max(280, rect.width),
          height: Math.max(320, heightPx),
        });
      };
      update();
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }, [heightPx]);

    /** Translate the pointer's screen position into world (cm)
     *  coordinates, accounting for pan + zoom. */
    function pointerWorld(): Point | null {
      const stage = stageRef.current;
      if (!stage) return null;
      const pos = stage.getPointerPosition();
      if (!pos) return null;
      return {
        x: (pos.x - viewport.x) / viewport.scale,
        y: (pos.y - viewport.y) / viewport.scale,
      };
    }

    /** Apply endpoint snap if any candidate is within range; fall
     *  back to grid snap otherwise. Updates the visible snap
     *  indicator as a side-effect. */
    function snappedPointer(): Point | null {
      const world = pointerWorld();
      if (!world) return null;
      const radius = SNAP_THRESHOLD_PX / viewport.scale;
      const target = findClosestSnap(world, snapTargets, radius);
      if (target) {
        setSnapIndicator(target.point);
        return { ...target.point };
      }
      setSnapIndicator(null);
      return snapPoint(world);
    }

    function zoomBy(factor: number) {
      const next = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, viewport.scale * factor),
      );
      const cx = size.width / 2;
      const cy = size.height / 2;
      const worldX = (cx - viewport.x) / viewport.scale;
      const worldY = (cy - viewport.y) / viewport.scale;
      onViewportChange({
        x: cx - worldX * next,
        y: cy - worldY * next,
        scale: next,
      });
    }

    // Wheel = zoom toward cursor.
    const onWheel = useCallback(
      (e: Konva.KonvaEventObject<WheelEvent>) => {
        e.evt.preventDefault();
        const stage = stageRef.current;
        if (!stage) return;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const direction = e.evt.deltaY > 0 ? 1 / 1.1 : 1.1;
        const newScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, viewport.scale * direction),
        );
        const worldX = (pointer.x - viewport.x) / viewport.scale;
        const worldY = (pointer.y - viewport.y) / viewport.scale;
        onViewportChange({
          x: pointer.x - worldX * newScale,
          y: pointer.y - worldY * newScale,
          scale: newScale,
        });
      },
      [viewport, onViewportChange],
    );

    // ------------------------------------------------------ draw events

    const beginDraw = useCallback(
      (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
        if (readOnly) return;
        const isBackground = e.target === e.target.getStage();
        const p = snappedPointer();
        if (!p) return;
        const additive = isAdditiveEvent(e);

        if (tool === "wall" && isBackground) {
          setDraft({ kind: "wall", x1: p.x, y1: p.y, x2: p.x, y2: p.y });
        } else if (tool === "location" && isBackground) {
          setDraft({
            kind: "location",
            x: snapCm(p.x - DEFAULT_LOCATION_CM / 2),
            y: snapCm(p.y - DEFAULT_LOCATION_CM / 2),
            width: DEFAULT_LOCATION_CM,
            height: DEFAULT_LOCATION_CM,
          });
        } else if (tool === "outline" && isBackground) {
          if (draft?.kind === "outline") {
            const first = draft.points[0];
            if (first && distance(p, first) < SNAP_THRESHOLD_PX / viewport.scale) {
              if (draft.points.length >= 3) onOutlineCommitted(draft.points);
              setDraft(null);
              setSnapIndicator(null);
              return;
            }
            setDraft({ kind: "outline", points: [...draft.points, p] });
          } else {
            setDraft({ kind: "outline", points: [p] });
          }
        } else if (tool === "hole" && isBackground) {
          if (draft?.kind === "hole") {
            const first = draft.points[0];
            if (first && distance(p, first) < SNAP_THRESHOLD_PX / viewport.scale) {
              if (draft.points.length >= 3) onHoleCommitted(draft.points);
              setDraft(null);
              setSnapIndicator(null);
              return;
            }
            setDraft({ kind: "hole", points: [...draft.points, p] });
          } else {
            setDraft({ kind: "hole", points: [p] });
          }
        } else if (tool === "select" && isBackground) {
          // Start a marquee. Use raw cursor position (no grid snap)
          // so the rectangle tracks the finger / cursor exactly.
          const raw = pointerWorld();
          if (!raw) return;
          setDraft({
            kind: "marquee",
            x1: raw.x,
            y1: raw.y,
            x2: raw.x,
            y2: raw.y,
            additive,
          });
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [tool, readOnly, draft, viewport.scale, snapTargets],
    );

    const updateDraw = useCallback(() => {
      if (!draft) {
        if (tool === "outline" || tool === "hole" || tool === "wall") {
          snappedPointer();
        }
        return;
      }

      if (draft.kind === "marquee") {
        const raw = pointerWorld();
        if (!raw) return;
        setDraft({ ...draft, x2: raw.x, y2: raw.y });
        return;
      }

      const p = snappedPointer();
      if (!p) return;

      if (draft.kind === "wall") {
        setDraft({ ...draft, x2: p.x, y2: p.y });
      } else if (draft.kind === "location") {
        setDraft({
          ...draft,
          width: Math.max(GRID_MINOR_CM, p.x - draft.x),
          height: Math.max(GRID_MINOR_CM, p.y - draft.y),
        });
      }
    }, [draft, tool, viewport.scale]);

    const finishDraw = useCallback(() => {
      if (!draft) return;
      if (draft.kind === "wall") {
        if (draft.x1 === draft.x2 && draft.y1 === draft.y2) {
          setDraft(null);
          return;
        }
        onWallAdded({
          id: crypto.randomUUID(),
          x1: draft.x1,
          y1: draft.y1,
          x2: draft.x2,
          y2: draft.y2,
        });
        setDraft(null);
        return;
      }
      if (draft.kind === "location") {
        onLocationAdded({
          x: draft.x,
          y: draft.y,
          width: Math.max(GRID_MINOR_CM, draft.width),
          height: Math.max(GRID_MINOR_CM, draft.height),
        });
        setDraft(null);
        return;
      }
      if (draft.kind === "marquee") {
        const box = normaliseRect(
          draft.x1,
          draft.y1,
          draft.x2 - draft.x1,
          draft.y2 - draft.y1,
        );
        // World-space threshold for "this is a click, not a drag".
        const tinyWorld = MIN_MARQUEE_PX / viewport.scale;
        if (box.width < tinyWorld && box.height < tinyWorld) {
          // Click on empty space — clear selection unless additive.
          if (!draft.additive) onSelectionChange([]);
          setDraft(null);
          return;
        }
        const found = itemsInMarquee(box, walls, locations, outline);
        onSelectionChange(
          draft.additive ? mergeSelections(selection, found) : found,
        );
        setDraft(null);
        return;
      }
      // Outline / hole stay in draft until explicit close (click on
      // first vertex) or double-click.
    }, [
      draft,
      onWallAdded,
      onLocationAdded,
      onSelectionChange,
      selection,
      walls,
      locations,
      outline,
      viewport.scale,
    ]);

    /** Commit the in-progress outline / hole. Bound to dblclick. */
    function dblCommitDraft() {
      if (!draft) return;
      if (draft.kind === "outline" && draft.points.length >= 3) {
        onOutlineCommitted(draft.points);
      } else if (draft.kind === "hole" && draft.points.length >= 3) {
        onHoleCommitted(draft.points);
      }
      setDraft(null);
      setSnapIndicator(null);
    }

    // ----------------------------------------------------------- pan

    const [isPanning, setIsPanning] = useState(false);
    const panStart = useRef<{
      mouseX: number;
      mouseY: number;
      viewX: number;
      viewY: number;
    } | null>(null);

    function onStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
      const isMiddle = e.evt.button === 1;
      const shouldPan = tool === "pan" || isMiddle;
      if (shouldPan) {
        e.evt.preventDefault();
        const pos = e.target.getStage()?.getPointerPosition();
        if (!pos) return;
        setIsPanning(true);
        panStart.current = {
          mouseX: pos.x,
          mouseY: pos.y,
          viewX: viewport.x,
          viewY: viewport.y,
        };
        return;
      }
      beginDraw(e);
    }

    function onStageMouseMove() {
      if (isPanning && panStart.current) {
        const pos = stageRef.current?.getPointerPosition();
        if (!pos) return;
        onViewportChange({
          ...viewport,
          x: panStart.current.viewX + (pos.x - panStart.current.mouseX),
          y: panStart.current.viewY + (pos.y - panStart.current.mouseY),
        });
        return;
      }
      updateDraw();
    }

    function onStageMouseUp() {
      if (isPanning) {
        setIsPanning(false);
        panStart.current = null;
        return;
      }
      finishDraw();
    }

    // -------------------------------------------------------- touch

    const touchState = useRef<
      | null
      | {
          mode: "pan" | "pinch";
          startDist?: number;
          startScale?: number;
          startCenterScreen?: { x: number; y: number };
          startCenterWorld?: { x: number; y: number };
          startViewport?: { x: number; y: number };
          startTouch?: { x: number; y: number };
        }
    >(null);

    function getTouchCenter(touches: TouchList) {
      const a = touches[0]!;
      const b = touches[1]!;
      return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    }
    function getTouchDist(touches: TouchList) {
      const a = touches[0]!;
      const b = touches[1]!;
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }

    function onTouchStart(e: Konva.KonvaEventObject<TouchEvent>) {
      const touches = e.evt.touches;
      if (touches.length === 2) {
        // Two-finger pinch — switch into zoom/pan mode regardless of
        // the active tool. Cancels any draft.
        e.evt.preventDefault();
        if (draft) setDraft(null);
        const stage = stageRef.current;
        if (!stage) return;
        const center = getTouchCenter(touches);
        const containerRect = stage.container().getBoundingClientRect();
        const stageCenter = {
          x: center.x - containerRect.left,
          y: center.y - containerRect.top,
        };
        touchState.current = {
          mode: "pinch",
          startDist: getTouchDist(touches),
          startScale: viewport.scale,
          startCenterScreen: stageCenter,
          startCenterWorld: {
            x: (stageCenter.x - viewport.x) / viewport.scale,
            y: (stageCenter.y - viewport.y) / viewport.scale,
          },
          startViewport: { x: viewport.x, y: viewport.y },
        };
        return;
      }

      if (touches.length === 1) {
        if (tool === "pan") {
          const t = touches[0]!;
          touchState.current = {
            mode: "pan",
            startViewport: { x: viewport.x, y: viewport.y },
            startTouch: { x: t.clientX, y: t.clientY },
          };
          return;
        }
        beginDraw(e);
      }
    }

    function onTouchMove(e: Konva.KonvaEventObject<TouchEvent>) {
      const touches = e.evt.touches;
      const st = touchState.current;

      if (st?.mode === "pinch" && touches.length === 2 && st.startDist) {
        e.evt.preventDefault();
        const dist = getTouchDist(touches);
        const newScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, st.startScale! * (dist / st.startDist)),
        );
        onViewportChange({
          x: st.startCenterScreen!.x - st.startCenterWorld!.x * newScale,
          y: st.startCenterScreen!.y - st.startCenterWorld!.y * newScale,
          scale: newScale,
        });
        return;
      }

      if (st?.mode === "pan" && touches.length === 1) {
        const t = touches[0]!;
        onViewportChange({
          ...viewport,
          x: st.startViewport!.x + (t.clientX - st.startTouch!.x),
          y: st.startViewport!.y + (t.clientY - st.startTouch!.y),
        });
        return;
      }

      if (touches.length === 1) {
        updateDraw();
      }
    }

    function onTouchEnd() {
      if (touchState.current?.mode === "pinch") {
        touchState.current = null;
        return;
      }
      if (touchState.current?.mode === "pan") {
        touchState.current = null;
        return;
      }
      finishDraw();
    }

    // ------------------------------------------------------- cursors

    const cursorClass = readOnly
      ? "cursor-default"
      : tool === "pan" || isPanning
        ? isPanning
          ? "cursor-grabbing"
          : "cursor-grab"
        : tool === "select"
          ? "cursor-default"
          : "cursor-crosshair";

    const visibleLocations = locations.filter((l) => !l.deleted);

    return (
      <div
        ref={containerRef}
        className={cn(
          "relative w-full overflow-hidden rounded-md border border-border/60 bg-muted/30",
          cursorClass,
        )}
        style={{ height: heightPx, touchAction: "none" }}
      >
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          onWheel={onWheel}
          onMouseDown={onStageMouseDown}
          onMouseMove={onStageMouseMove}
          onMouseUp={onStageMouseUp}
          onDblClick={dblCommitDraft}
          onDblTap={dblCommitDraft}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onMouseLeave={() => {
            if (isPanning) {
              setIsPanning(false);
              panStart.current = null;
            }
          }}
        >
          {/* Grid */}
          <Layer listening={false}>
            <GridLayer />
          </Layer>

          {/* Floor outline */}
          {outline && outline.points.length >= 3 && (
            <Layer>
              {/* Fill polygon — no stroke; the per-edge overlay
                  shapes below paint the visible border so each edge
                  can be hit-tested and selected independently. */}
              <Shape
                sceneFunc={(ctx, shape) => {
                  ctx.beginPath();
                  tracePolygonPath(ctx, outline.points, outline.edgeBows);
                  for (const hole of outline.holes ?? []) {
                    if (hole.points.length < 3) continue;
                    tracePolygonPath(ctx, hole.points, hole.edgeBows);
                  }
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const native = ctx as any;
                  native.fillStyle = shape.fill();
                  if (native.fill) native.fill("evenodd");
                }}
                hitFunc={(ctx, shape) => {
                  ctx.beginPath();
                  tracePolygonPath(ctx, outline.points, outline.edgeBows);
                  ctx.fillStrokeShape(shape);
                }}
                fill="rgba(241,245,249,1)"
                onClick={(e) => selectItem({ kind: "outline" }, e)}
                onTap={(e) => selectItem({ kind: "outline" }, e)}
              />
              {/* Per-edge selectable strokes — each edge intercepts
                  clicks on top of the fill so it can be bowed
                  individually. */}
              {outline.points.map((_, i) => {
                const p1 = outline.points[i]!;
                const p2 = outline.points[
                  (i + 1) % outline.points.length
                ]!;
                const bow = outline.edgeBows?.[i] ?? 0;
                const edgeItem: SelectionItem = {
                  kind: "outline-edge",
                  index: i,
                };
                const outlineSelected = isSelected(selection, {
                  kind: "outline",
                });
                return (
                  <PolygonEdgeShape
                    key={`oe-${i}`}
                    p1={p1}
                    p2={p2}
                    bow={bow}
                    selected={isSelected(selection, edgeItem)}
                    parentSelected={outlineSelected}
                    color="outline"
                    readOnly={readOnly}
                    viewportScale={viewport.scale}
                    onSelect={(e) => selectItem(edgeItem, e)}
                    onBowChange={(b) => onOutlineEdgeBowChange(i, b)}
                  />
                );
              })}
              {(outline.holes ?? []).map((hole) => (
                <HoleOutline
                  key={hole.id}
                  hole={hole}
                  selection={selection}
                  readOnly={readOnly}
                  viewportScale={viewport.scale}
                  onSelectHole={(e) =>
                    selectItem({ kind: "hole", id: hole.id }, e)
                  }
                  onSelectEdge={(index, e) =>
                    selectItem(
                      { kind: "hole-edge", holeId: hole.id, index },
                      e,
                    )
                  }
                  onEdgeBowChange={(index, bow) =>
                    onHoleEdgeBowChange(hole.id, index, bow)
                  }
                />
              ))}
              {isSelected(selection, { kind: "outline" }) &&
                outline.points.map((p, i) => (
                  <Circle
                    key={`v-${i}`}
                    x={p.x}
                    y={p.y}
                    radius={6 / viewport.scale}
                    fill="rgb(59,130,246)"
                    listening={false}
                  />
                ))}
            </Layer>
          )}

          {/* Walls */}
          <Layer>
            {walls.map((wall) => (
              <WallShape
                key={wall.id}
                wall={wall}
                selected={isSelected(selection, { kind: "wall", id: wall.id })}
                readOnly={readOnly}
                viewportScale={viewport.scale}
                onSelect={(e) => selectItem({ kind: "wall", id: wall.id }, e)}
                onBowChange={(bow) => onWallBowChange(wall.id, bow)}
                onGroupMove={onSelectionMove}
              />
            ))}
          </Layer>

          {/* Locations */}
          <Layer>
            {visibleLocations.map((loc) => {
              const id = loc.tempId ?? loc.uuid;
              return (
                <LocationShape
                  key={id ?? loc.id}
                  location={loc}
                  selected={isSelected(selection, { kind: "location", id })}
                  readOnly={readOnly}
                  onSelect={(e) => selectItem({ kind: "location", id }, e)}
                  onGroupMove={onSelectionMove}
                />
              );
            })}
          </Layer>

          {/* Drafts + snap indicator */}
          <Layer listening={false}>
            {draft?.kind === "wall" && (
              <Line
                points={[draft.x1, draft.y1, draft.x2, draft.y2]}
                stroke="rgb(59,130,246)"
                strokeWidth={6}
                lineCap="round"
                dash={[10, 6]}
              />
            )}
            {draft?.kind === "location" && (
              <Rect
                x={Math.min(draft.x, draft.x + draft.width)}
                y={Math.min(draft.y, draft.y + draft.height)}
                width={Math.abs(draft.width)}
                height={Math.abs(draft.height)}
                fill="rgba(16,185,129,0.15)"
                stroke="rgb(16,185,129)"
                strokeWidth={2}
                dash={[6, 4]}
              />
            )}
            {draft?.kind === "outline" && (
              <DraftPolyline
                points={draft.points}
                color="rgb(59,130,246)"
                viewportScale={viewport.scale}
              />
            )}
            {draft?.kind === "hole" && (
              <DraftPolyline
                points={draft.points}
                color="rgb(239,68,68)"
                viewportScale={viewport.scale}
              />
            )}
            {snapIndicator && (
              <Circle
                x={snapIndicator.x}
                y={snapIndicator.y}
                radius={SNAP_THRESHOLD_PX / viewport.scale}
                stroke="rgb(59,130,246)"
                strokeWidth={2 / viewport.scale}
                opacity={0.8}
              />
            )}
            {draft?.kind === "marquee" && (
              <Rect
                x={Math.min(draft.x1, draft.x2)}
                y={Math.min(draft.y1, draft.y2)}
                width={Math.abs(draft.x2 - draft.x1)}
                height={Math.abs(draft.y2 - draft.y1)}
                fill="rgba(59,130,246,0.08)"
                stroke="rgb(59,130,246)"
                strokeWidth={1 / viewport.scale}
                dash={[6 / viewport.scale, 4 / viewport.scale]}
              />
            )}
          </Layer>
        </Stage>

        {/* Bottom-right overlays. Outside the Stage so they don't
            pan/scale with the canvas. */}
        <div className="pointer-events-none absolute bottom-2 right-2 flex flex-col items-end gap-1">
          <ScaleBar viewportScale={viewport.scale} />
          <div className="rounded-md bg-background/80 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur">
            {Math.round(viewport.scale * 100)}%
          </div>
        </div>

        {/* Status badge for in-progress polygon draw. Helps the user
            understand they need to click the first vertex (or dbl)
            to commit. */}
        {(draft?.kind === "outline" || draft?.kind === "hole") && (
          <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-foreground/85 px-2 py-1 text-[11px] font-medium text-background shadow-sm backdrop-blur">
            {draft.kind === "outline" ? "Drawing floor outline" : "Drawing hole"}
            {" · "}
            Click first vertex or double-click to close
            {draft.points.length < 3 && ` · ${3 - draft.points.length} more`}
          </div>
        )}
      </div>
    );
  },
);

// ----------------------------------------------------------------
// Internal helpers + shape components

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Read shift / ctrl / cmd off a Konva event. We treat any of the
 *  three as "additive" — shift on Mac, ctrl on Windows / Linux, cmd
 *  for the Mac browsers that emit metaKey instead. */
function isAdditiveEvent(
  e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
): boolean {
  const evt = e.evt as MouseEvent | TouchEvent & {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  };
  return !!(
    (evt as MouseEvent).shiftKey ||
    (evt as MouseEvent).ctrlKey ||
    (evt as MouseEvent).metaKey
  );
}

function GridLayer() {
  // World bounds for the grid render. 50m × 50m around origin is
  // plenty for a single warehouse floor; pan/zoom is unlimited.
  const halfSize = 5000; // 50m in cm

  const minorLines: React.ReactNode[] = [];
  const majorLines: React.ReactNode[] = [];

  for (let x = -halfSize; x <= halfSize; x += GRID_MINOR_CM) {
    const isMajor = x % GRID_MAJOR_CM === 0;
    const stroke =
      x === 0
        ? "rgba(15,23,42,0.32)"
        : isMajor
          ? "rgba(15,23,42,0.12)"
          : "rgba(15,23,42,0.05)";
    const line = (
      <Line
        key={`v-${x}`}
        points={[x, -halfSize, x, halfSize]}
        stroke={stroke}
        strokeWidth={1}
      />
    );
    if (isMajor || x === 0) majorLines.push(line);
    else minorLines.push(line);
  }
  for (let y = -halfSize; y <= halfSize; y += GRID_MINOR_CM) {
    const isMajor = y % GRID_MAJOR_CM === 0;
    const stroke =
      y === 0
        ? "rgba(15,23,42,0.32)"
        : isMajor
          ? "rgba(15,23,42,0.12)"
          : "rgba(15,23,42,0.05)";
    const line = (
      <Line
        key={`h-${y}`}
        points={[-halfSize, y, halfSize, y]}
        stroke={stroke}
        strokeWidth={1}
      />
    );
    if (isMajor || y === 0) majorLines.push(line);
    else minorLines.push(line);
  }
  return (
    <>
      {minorLines}
      {majorLines}
    </>
  );
}

type SelectHandler = (
  e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
) => void;

function WallShape({
  wall,
  selected,
  readOnly,
  viewportScale,
  onSelect,
  onBowChange,
  onGroupMove,
}: {
  wall: Wall;
  selected: boolean;
  readOnly: boolean;
  viewportScale: number;
  onSelect: SelectHandler;
  onBowChange: (bow: number) => void;
  /** Fire on drag end of this wall — the canvas-level handler
   *  applies the snapped (dx, dy) translation to every selected
   *  item so a multi-select drag is a single undo step. The wall
   *  is itself part of the selection, so it moves too. */
  onGroupMove: (dx: number, dy: number) => void;
}) {
  const bow = wall.bow ?? 0;
  const isCurved = Math.abs(bow) > 0.5;

  const stroke = selected ? "rgb(59,130,246)" : "rgb(45,45,45)";
  const strokeWidth = selected ? 12 : 10;
  const draggable = !readOnly && selected;

  // Common drag end: snap the Konva node offset to the 50cm grid,
  // fire the canvas-level handler with that delta, then zero the
  // node so the next render (which has the new wall coords baked
  // into `points`) doesn't double-offset.
  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const dx = snapCm(e.target.x());
    const dy = snapCm(e.target.y());
    e.target.position({ x: 0, y: 0 });
    if (dx !== 0 || dy !== 0) onGroupMove(dx, dy);
  };

  // Straight wall is rendered as a Konva.Line so we keep the well-
  // tested hit detection. Curved walls use a Shape with sceneFunc +
  // hitFunc so the click area follows the curve, not the chord.
  const wallNode = isCurved ? (
    <Shape
      sceneFunc={(ctx, shape) => {
        const c = bezierControl(wall);
        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.quadraticCurveTo(c.x, c.y, wall.x2, wall.y2);
        ctx.strokeShape(shape);
      }}
      hitFunc={(ctx, shape) => {
        const c = bezierControl(wall);
        ctx.beginPath();
        ctx.moveTo(wall.x1, wall.y1);
        ctx.quadraticCurveTo(c.x, c.y, wall.x2, wall.y2);
        ctx.strokeShape(shape);
      }}
      stroke={stroke}
      strokeWidth={strokeWidth}
      lineCap="round"
      hitStrokeWidth={28}
      draggable={draggable}
      onClick={readOnly ? undefined : onSelect}
      onTap={readOnly ? undefined : onSelect}
      onDragEnd={draggable ? handleDragEnd : undefined}
    />
  ) : (
    <Line
      points={[wall.x1, wall.y1, wall.x2, wall.y2]}
      stroke={stroke}
      strokeWidth={strokeWidth}
      lineCap="round"
      onClick={readOnly ? undefined : onSelect}
      onTap={readOnly ? undefined : onSelect}
      hitStrokeWidth={28}
      draggable={draggable}
      onDragEnd={draggable ? handleDragEnd : undefined}
    />
  );

  if (!selected || readOnly) {
    return wallNode;
  }

  // Bow handle — visible only when the wall is selected. Sits at the
  // arc midpoint; drag it perpendicular to the chord to bow the wall.
  // Snap to 50 cm so curves feel as crisp as straight walls.
  const mid = chordMidpoint(wall);
  const handle = bowHandlePoint(wall);
  const r = 9 / viewportScale;
  return (
    <>
      {wallNode}
      {/* Faint guide line from chord midpoint to the bow handle so
          the perpendicular axis is obvious while dragging. */}
      <Line
        points={[mid.x, mid.y, handle.x, handle.y]}
        stroke="rgba(59,130,246,0.45)"
        strokeWidth={1 / viewportScale}
        dash={[4 / viewportScale, 3 / viewportScale]}
        listening={false}
      />
      <Circle
        x={handle.x}
        y={handle.y}
        radius={r}
        fill="white"
        stroke="rgb(59,130,246)"
        strokeWidth={2 / viewportScale}
        draggable
        onDragMove={(e) => {
          // Constrain the handle visually to the perpendicular axis
          // so the user only feels a 1-D drag. The bow value is the
          // signed projection onto that axis.
          const p = projectOntoPerpendicular(wall, {
            x: e.target.x(),
            y: e.target.y(),
          });
          e.target.position(p.handle);
        }}
        onDragEnd={(e) => {
          const newBow = signedBowFromHandle(wall, {
            x: e.target.x(),
            y: e.target.y(),
          });
          // Snap to 50 cm to match the rest of the grid feel.
          const snapped = Math.round(newBow / 50) * 50;
          // Move the handle visually onto the snapped position to
          // avoid a one-frame jump on the next render.
          const newHandle = snappedHandlePosition(wall, snapped);
          e.target.position(newHandle);
          onBowChange(snapped);
        }}
      />
    </>
  );
}

// --- Wall-curve geometry kept inline so the shape component stays
//     self-contained. (Same math as plan-utils.wallControlPoint
//     et al., but local to avoid prop-drilling helpers through Konva.)

function chordMidpoint(wall: Wall): Point {
  return { x: (wall.x1 + wall.x2) / 2, y: (wall.y1 + wall.y2) / 2 };
}

function chordPerpendicular(wall: Wall): Point {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0 };
  return { x: -dy / len, y: dx / len };
}

function bowHandlePoint(wall: Wall): Point {
  const m = chordMidpoint(wall);
  const p = chordPerpendicular(wall);
  const bow = wall.bow ?? 0;
  return { x: m.x + p.x * bow, y: m.y + p.y * bow };
}

function bezierControl(wall: Wall): Point {
  const m = chordMidpoint(wall);
  const p = chordPerpendicular(wall);
  const bow = wall.bow ?? 0;
  return { x: m.x + p.x * 2 * bow, y: m.y + p.y * 2 * bow };
}

function signedBowFromHandle(wall: Wall, candidate: Point): number {
  const m = chordMidpoint(wall);
  const p = chordPerpendicular(wall);
  return (candidate.x - m.x) * p.x + (candidate.y - m.y) * p.y;
}

function projectOntoPerpendicular(
  wall: Wall,
  candidate: Point,
): { handle: Point } {
  const m = chordMidpoint(wall);
  const p = chordPerpendicular(wall);
  const bow = (candidate.x - m.x) * p.x + (candidate.y - m.y) * p.y;
  return { handle: { x: m.x + p.x * bow, y: m.y + p.y * bow } };
}

function snappedHandlePosition(wall: Wall, snappedBow: number): Point {
  const m = chordMidpoint(wall);
  const p = chordPerpendicular(wall);
  return { x: m.x + p.x * snappedBow, y: m.y + p.y * snappedBow };
}

/** Trace a closed (possibly-curved) polygon onto a 2D canvas context.
 *  Each edge follows either a straight line or a quadratic Bezier
 *  depending on the matching `edgeBows[i]` entry. Caller is
 *  responsible for `ctx.beginPath()` and `closePath()` semantics —
 *  the function itself just emits moveTo / lineTo / quadraticCurveTo
 *  + closePath so it can be combined with other sub-paths
 *  (e.g. the outline plus its hole cutouts for an evenodd fill). */
function tracePolygonPath(
  ctx: Konva.Context | CanvasRenderingContext2D,
  points: Point[],
  edgeBows: number[] | undefined,
): void {
  const n = points.length;
  if (n < 3) return;
  const p0 = points[0]!;
  ctx.moveTo(p0.x, p0.y);
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const bow = edgeBows?.[i] ?? 0;
    if (Math.abs(bow) > 0.5) {
      const c = edgeControlPoint(a, b, bow);
      ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
    } else {
      ctx.lineTo(b.x, b.y);
    }
  }
  ctx.closePath();
}

/** Shared per-edge component for outline + hole polygons. Renders
 *  the visible stroke for that edge as a Line or curved Shape,
 *  intercepts clicks to select the edge, and (when selected) draws
 *  the perpendicular bow handle the user grabs to bend the edge. */
function PolygonEdgeShape({
  p1,
  p2,
  bow,
  selected,
  parentSelected,
  color,
  readOnly,
  viewportScale,
  onSelect,
  onBowChange,
}: {
  p1: Point;
  p2: Point;
  bow: number;
  selected: boolean;
  /** True when the parent polygon (whole outline / whole hole) is
   *  selected — used so the edge highlights too instead of staying
   *  in its default colour. */
  parentSelected: boolean;
  /** Visual variant — outline uses the dark perimeter colour, holes
   *  use the dashed red cutout colour. */
  color: "outline" | "hole";
  readOnly: boolean;
  viewportScale: number;
  onSelect: SelectHandler;
  onBowChange: (bow: number) => void;
}) {
  const isCurved = Math.abs(bow) > 0.5;
  const palette =
    color === "outline"
      ? { selected: "rgb(59,130,246)", base: "rgba(15,23,42,0.55)" }
      : { selected: "rgb(239,68,68)", base: "rgba(239,68,68,0.7)" };
  const stroke =
    selected || parentSelected ? palette.selected : palette.base;
  const baseWidth = color === "outline" ? 2 : 1.5;
  const strokeWidth = selected ? baseWidth + 1 : baseWidth;
  const dash = color === "hole" ? [8, 4] : undefined;

  const edgeNode = isCurved ? (
    <Shape
      sceneFunc={(ctx, shape) => {
        const c = edgeControlPoint(p1, p2, bow);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.quadraticCurveTo(c.x, c.y, p2.x, p2.y);
        ctx.strokeShape(shape);
      }}
      hitFunc={(ctx, shape) => {
        const c = edgeControlPoint(p1, p2, bow);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.quadraticCurveTo(c.x, c.y, p2.x, p2.y);
        ctx.strokeShape(shape);
      }}
      stroke={stroke}
      strokeWidth={strokeWidth}
      lineCap="round"
      dash={dash}
      hitStrokeWidth={20}
      onClick={readOnly ? undefined : onSelect}
      onTap={readOnly ? undefined : onSelect}
    />
  ) : (
    <Line
      points={[p1.x, p1.y, p2.x, p2.y]}
      stroke={stroke}
      strokeWidth={strokeWidth}
      lineCap="round"
      dash={dash}
      onClick={readOnly ? undefined : onSelect}
      onTap={readOnly ? undefined : onSelect}
      hitStrokeWidth={20}
    />
  );

  if (!selected || readOnly) return edgeNode;

  const mid = edgeChordMidpoint(p1, p2);
  const handle = edgeBowHandle(p1, p2, bow);
  const r = 9 / viewportScale;
  return (
    <>
      {edgeNode}
      <Line
        points={[mid.x, mid.y, handle.x, handle.y]}
        stroke="rgba(59,130,246,0.45)"
        strokeWidth={1 / viewportScale}
        dash={[4 / viewportScale, 3 / viewportScale]}
        listening={false}
      />
      <Circle
        x={handle.x}
        y={handle.y}
        radius={r}
        fill="white"
        stroke="rgb(59,130,246)"
        strokeWidth={2 / viewportScale}
        draggable
        onDragMove={(e) => {
          const proj = projectEdgeHandleAxis(p1, p2, {
            x: e.target.x(),
            y: e.target.y(),
          });
          e.target.position(proj.handle);
        }}
        onDragEnd={(e) => {
          const newBow = projectEdgeBow(p1, p2, {
            x: e.target.x(),
            y: e.target.y(),
          });
          const snapped = Math.round(newBow / 50) * 50;
          const snappedHandle = edgeBowHandle(p1, p2, snapped);
          e.target.position(snappedHandle);
          onBowChange(snapped);
        }}
      />
    </>
  );
}

function HoleOutline({
  hole,
  selection,
  readOnly,
  viewportScale,
  onSelectHole,
  onSelectEdge,
  onEdgeBowChange,
}: {
  hole: Hole;
  selection: SelectionSet;
  readOnly: boolean;
  viewportScale: number;
  onSelectHole: SelectHandler;
  onSelectEdge: (
    index: number,
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => void;
  onEdgeBowChange: (index: number, bow: number) => void;
}) {
  if (hole.points.length < 2) return null;
  const holeSelected = isSelected(selection, { kind: "hole", id: hole.id });

  // Tiny invisible Shape giving the hole interior a hit area so
  // tapping the cutout selects the whole hole (matches pre-curve
  // behaviour — clicking inside the dashed boundary selects the
  // hole as a whole). The per-edge shapes below paint the visible
  // dashed stroke and intercept edge clicks.
  return (
    <>
      {hole.points.length >= 3 && (
        <Shape
          sceneFunc={() => {
            // No visible draw — fill handled by the parent outline.
          }}
          hitFunc={(ctx, shape) => {
            ctx.beginPath();
            tracePolygonPath(ctx, hole.points, hole.edgeBows);
            ctx.fillStrokeShape(shape);
          }}
          fill="transparent"
          onClick={readOnly ? undefined : onSelectHole}
          onTap={readOnly ? undefined : onSelectHole}
        />
      )}
      {hole.points.map((_, i) => {
        const p1 = hole.points[i]!;
        const p2 = hole.points[(i + 1) % hole.points.length]!;
        const bow = hole.edgeBows?.[i] ?? 0;
        const edgeItem: SelectionItem = {
          kind: "hole-edge",
          holeId: hole.id,
          index: i,
        };
        return (
          <PolygonEdgeShape
            key={`he-${hole.id}-${i}`}
            p1={p1}
            p2={p2}
            bow={bow}
            selected={isSelected(selection, edgeItem)}
            parentSelected={holeSelected}
            color="hole"
            readOnly={readOnly}
            viewportScale={viewportScale}
            onSelect={(e) => onSelectEdge(i, e)}
            onBowChange={(b) => onEdgeBowChange(i, b)}
          />
        );
      })}
    </>
  );
}

function LocationShape({
  location,
  selected,
  readOnly,
  onSelect,
  onGroupMove,
}: {
  location: LocalLocation;
  selected: boolean;
  readOnly: boolean;
  onSelect: SelectHandler;
  /** Fire on drag end of this location — the canvas-level handler
   *  applies the snapped (dx, dy) to every selected item so group
   *  moves are a single undo step. The dragged location is always
   *  selected so it moves too. */
  onGroupMove: (dx: number, dy: number) => void;
}) {
  const kindColor: Record<string, { fill: string; stroke: string }> = {
    rack: { fill: "rgba(16,185,129,0.18)", stroke: "rgb(16,185,129)" },
    shelf: { fill: "rgba(59,130,246,0.18)", stroke: "rgb(59,130,246)" },
    pallet_zone: { fill: "rgba(245,158,11,0.18)", stroke: "rgb(245,158,11)" },
    cold_storage: { fill: "rgba(14,165,233,0.18)", stroke: "rgb(14,165,233)" },
    hazmat: { fill: "rgba(239,68,68,0.18)", stroke: "rgb(239,68,68)" },
    staging: { fill: "rgba(168,85,247,0.18)", stroke: "rgb(168,85,247)" },
    other: { fill: "rgba(100,116,139,0.18)", stroke: "rgb(100,116,139)" },
  };
  const palette = kindColor[location.kind ?? "other"] ?? kindColor.other;

  return (
    <Group
      x={location.x}
      y={location.y}
      draggable={!readOnly && selected}
      onClick={readOnly ? undefined : onSelect}
      onTap={readOnly ? undefined : onSelect}
      onDragEnd={(e) => {
        const node = e.target;
        const nx = snapCm(node.x());
        const ny = snapCm(node.y());
        node.position({ x: nx, y: ny });
        const dx = nx - location.x;
        const dy = ny - location.y;
        if (dx !== 0 || dy !== 0) onGroupMove(dx, dy);
      }}
    >
      <Rect
        width={location.width}
        height={location.height}
        fill={palette.fill}
        stroke={selected ? "rgb(59,130,246)" : palette.stroke}
        strokeWidth={selected ? 3 : 2}
        cornerRadius={6}
      />
      <Text
        text={location.code ? `${location.code}` : location.name || "—"}
        x={8}
        y={8}
        fontSize={14}
        fontStyle="bold"
        fill="rgba(15,23,42,0.85)"
        listening={false}
      />
      {location.code && location.name && (
        <Text
          text={location.name}
          x={8}
          y={26}
          fontSize={12}
          fill="rgba(51,65,85,0.7)"
          width={location.width - 16}
          ellipsis
          wrap="none"
          listening={false}
        />
      )}
    </Group>
  );
}

function DraftPolyline({
  points,
  color,
  viewportScale,
}: {
  points: Point[];
  color: string;
  viewportScale: number;
}) {
  if (points.length === 0) return null;
  const flat: number[] = [];
  for (const p of points) flat.push(p.x, p.y);
  return (
    <>
      <Line
        points={flat}
        stroke={color}
        strokeWidth={2}
        dash={[10, 6]}
        opacity={0.85}
      />
      {points.map((p, i) => (
        <Circle
          key={i}
          x={p.x}
          y={p.y}
          radius={(i === 0 ? 8 : 5) / viewportScale}
          fill={i === 0 ? color : "white"}
          stroke={color}
          strokeWidth={2 / viewportScale}
        />
      ))}
    </>
  );
}

function ScaleBar({ viewportScale }: { viewportScale: number }) {
  // 1m of world space in screen pixels.
  const widthPx = 100 * viewportScale;
  return (
    <div className="flex items-center gap-1 rounded-md bg-background/80 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur">
      <div
        className="h-1 rounded-sm bg-foreground/70"
        style={{ width: `${widthPx}px` }}
      />
      <span>1 m</span>
    </div>
  );
}

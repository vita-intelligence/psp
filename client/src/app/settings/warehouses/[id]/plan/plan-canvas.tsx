"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Stage, Layer, Rect, Line, Group, Text } from "react-konva";
import type Konva from "konva";
import { cn } from "@/lib/utils";
import type {
  LocalLocation,
  Room,
  Selection,
  ToolMode,
  Viewport,
  Wall,
} from "./plan-types";

interface PlanCanvasProps {
  walls: Wall[];
  rooms: Room[];
  locations: LocalLocation[];
  selection: Selection;
  tool: ToolMode;
  viewport: Viewport;
  /** Whether the canvas is in read-only mode (viewer permissions). */
  readOnly: boolean;
  onSelectionChange: (next: Selection) => void;
  onViewportChange: (next: Viewport) => void;
  onWallAdded: (wall: Wall) => void;
  onRoomAdded: (room: Room) => void;
  onLocationAdded: (location: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onLocationMove: (id: string | number, x: number, y: number) => void;
  onRoomMove: (id: string, x: number, y: number) => void;
}

export interface PlanCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
}

const GRID_SIZE = 20;
const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const DEFAULT_LOCATION_SIZE = 80;

/** Snap a canvas-world coordinate to the nearest grid line. */
function snap(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

/**
 * The Konva canvas itself. Responsible for rendering walls, rooms,
 * and storage locations + handling pan, zoom, draw, and select
 * interactions. Pure presentational with respect to data — the
 * parent owns state and gets called back on every interaction.
 *
 * Layers (back to front):
 *   1. Grid    — purely decorative, not interactive
 *   2. Rooms   — coloured rectangles with labels
 *   3. Walls   — thick lines on top of rooms
 *   4. Locations — bordered rects with code/name labels
 *
 * The Stage uses Konva's own pan/scale so coordinates inside Layer
 * stay in "world space" — no manual maths in shape render code.
 */
export const PlanCanvas = forwardRef<PlanCanvasHandle, PlanCanvasProps>(
  function PlanCanvas(
    {
      walls,
      rooms,
      locations,
      selection,
      tool,
      viewport,
      readOnly,
      onSelectionChange,
      onViewportChange,
      onWallAdded,
      onRoomAdded,
      onLocationAdded,
      onLocationMove,
      onRoomMove,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const stageRef = useRef<Konva.Stage | null>(null);
    // Track container size so the Stage stretches to fill it. Konva
    // doesn't auto-resize.
    const [size, setSize] = useState({ width: 800, height: 600 });

    // Live in-progress draw (drag from down to current). Persisted to
    // state on draw end. Null when not drawing.
    const [draft, setDraft] = useState<
      | { kind: "wall"; x1: number; y1: number; x2: number; y2: number }
      | {
          kind: "room" | "location";
          x: number;
          y: number;
          width: number;
          height: number;
        }
      | null
    >(null);

    useImperativeHandle(
      ref,
      () => ({
        zoomIn: () => zoomBy(1.2),
        zoomOut: () => zoomBy(1 / 1.2),
        resetView: () => onViewportChange({ x: 0, y: 0, scale: 1 }),
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [viewport.scale],
    );

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const update = () => {
        const rect = el.getBoundingClientRect();
        setSize({
          width: Math.max(320, rect.width),
          height: Math.max(400, rect.height),
        });
      };
      update();
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    /** Translate a pointer event's screen position into world (canvas)
     *  coordinates, accounting for pan + zoom. */
    function pointerWorld(): { x: number; y: number } | null {
      const stage = stageRef.current;
      if (!stage) return null;
      const pos = stage.getPointerPosition();
      if (!pos) return null;
      return {
        x: (pos.x - viewport.x) / viewport.scale,
        y: (pos.y - viewport.y) / viewport.scale,
      };
    }

    function zoomBy(factor: number) {
      const next = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, viewport.scale * factor),
      );
      // Keep the centre of the visible area fixed during programmatic
      // zoom — feels natural compared to "from origin".
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

    // Wheel = zoom toward cursor. Same UX as Figma, Miro, etc.
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

    const onMouseDown = useCallback(
      (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (readOnly) return;
        // Background hit? clicks on shapes bubble up too but with a
        // distinct target. Only start drawing/clearing when the user
        // clicked empty space.
        const isBackground = e.target === e.target.getStage();

        const world = pointerWorld();
        if (!world) return;

        if (tool === "wall" && isBackground) {
          const sx = snap(world.x);
          const sy = snap(world.y);
          setDraft({ kind: "wall", x1: sx, y1: sy, x2: sx, y2: sy });
        } else if (tool === "room" && isBackground) {
          setDraft({
            kind: "room",
            x: snap(world.x),
            y: snap(world.y),
            width: 0,
            height: 0,
          });
        } else if (tool === "location" && isBackground) {
          // Locations are click-to-place, fixed default size. Drag is
          // for finer dimensions — we commit on mouseup.
          setDraft({
            kind: "location",
            x: snap(world.x - DEFAULT_LOCATION_SIZE / 2),
            y: snap(world.y - DEFAULT_LOCATION_SIZE / 2),
            width: DEFAULT_LOCATION_SIZE,
            height: DEFAULT_LOCATION_SIZE,
          });
        } else if (tool === "select" && isBackground) {
          onSelectionChange({ kind: "none" });
        }
      },
      [tool, readOnly, viewport, onSelectionChange],
    );

    const onMouseMove = useCallback(() => {
      if (!draft) return;
      const world = pointerWorld();
      if (!world) return;
      const sx = snap(world.x);
      const sy = snap(world.y);

      if (draft.kind === "wall") {
        setDraft({ ...draft, x2: sx, y2: sy });
      } else if (draft.kind === "room") {
        setDraft({
          ...draft,
          width: sx - draft.x,
          height: sy - draft.y,
        });
      } else if (draft.kind === "location") {
        // For locations, mouse-move while dragging adjusts width/height
        // from the press point.
        setDraft({
          ...draft,
          width: Math.max(GRID_SIZE, sx - draft.x),
          height: Math.max(GRID_SIZE, sy - draft.y),
        });
      }
    }, [draft, viewport]);

    const onMouseUp = useCallback(() => {
      if (!draft) return;
      const d = draft;
      setDraft(null);

      if (d.kind === "wall") {
        // Drop zero-length walls — happens when the user clicks
        // without dragging.
        if (d.x1 === d.x2 && d.y1 === d.y2) return;
        onWallAdded({
          id: crypto.randomUUID(),
          x1: d.x1,
          y1: d.y1,
          x2: d.x2,
          y2: d.y2,
        });
      } else if (d.kind === "room") {
        // Normalise negative dimensions (the user dragged
        // up-and-left).
        const x = Math.min(d.x, d.x + d.width);
        const y = Math.min(d.y, d.y + d.height);
        const width = Math.abs(d.width);
        const height = Math.abs(d.height);
        if (width < GRID_SIZE || height < GRID_SIZE) return;
        onRoomAdded({
          id: crypto.randomUUID(),
          x,
          y,
          width,
          height,
        });
      } else if (d.kind === "location") {
        const x = Math.min(d.x, d.x + d.width);
        const y = Math.min(d.y, d.y + d.height);
        const width = Math.max(GRID_SIZE, Math.abs(d.width));
        const height = Math.max(GRID_SIZE, Math.abs(d.height));
        onLocationAdded({ x, y, width, height });
      }
    }, [draft, onWallAdded, onRoomAdded, onLocationAdded]);

    // Pan via drag with the "pan" tool active OR middle-click anywhere
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
      onMouseDown(e);
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
      onMouseMove();
    }

    function onStageMouseUp() {
      if (isPanning) {
        setIsPanning(false);
        panStart.current = null;
        return;
      }
      onMouseUp();
    }

    const cursorClass = readOnly
      ? "cursor-default"
      : tool === "pan" || isPanning
        ? isPanning
          ? "cursor-grabbing"
          : "cursor-grab"
        : tool === "select"
          ? "cursor-default"
          : "cursor-crosshair";

    // Visible storage locations only — `deleted: true` ones are
    // hidden but kept in state so save can DELETE them.
    const visibleLocations = locations.filter((l) => !l.deleted);

    return (
      <div
        ref={containerRef}
        className={cn(
          "relative h-[600px] w-full overflow-hidden rounded-md border border-border/60 bg-muted/30",
          cursorClass,
        )}
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
          onMouseLeave={() => {
            if (draft) onMouseUp();
            if (isPanning) {
              setIsPanning(false);
              panStart.current = null;
            }
          }}
        >
          {/* Grid layer — purely decorative, sized to a generous
              world bounds (5000x5000) so the user can drag well past
              the visible viewport before running out of grid. */}
          <Layer listening={false}>
            <GridLayer />
          </Layer>

          {/* Rooms */}
          <Layer>
            {rooms.map((room) => (
              <RoomShape
                key={room.id}
                room={room}
                selected={selection.kind === "room" && selection.id === room.id}
                readOnly={readOnly}
                onSelect={() =>
                  onSelectionChange({ kind: "room", id: room.id })
                }
                onDragEnd={(x, y) => onRoomMove(room.id, x, y)}
              />
            ))}

            {draft?.kind === "room" && (
              <Rect
                x={Math.min(draft.x, draft.x + draft.width)}
                y={Math.min(draft.y, draft.y + draft.height)}
                width={Math.abs(draft.width)}
                height={Math.abs(draft.height)}
                fill="rgba(59,130,246,0.08)"
                stroke="rgb(59,130,246)"
                strokeWidth={1.5}
                dash={[6, 4]}
                listening={false}
              />
            )}
          </Layer>

          {/* Walls */}
          <Layer>
            {walls.map((wall) => (
              <WallShape
                key={wall.id}
                wall={wall}
                selected={selection.kind === "wall" && selection.id === wall.id}
                readOnly={readOnly}
                onSelect={() =>
                  onSelectionChange({ kind: "wall", id: wall.id })
                }
              />
            ))}

            {draft?.kind === "wall" && (
              <Line
                points={[draft.x1, draft.y1, draft.x2, draft.y2]}
                stroke="rgb(59,130,246)"
                strokeWidth={6}
                lineCap="round"
                dash={[10, 6]}
                listening={false}
              />
            )}
          </Layer>

          {/* Locations */}
          <Layer>
            {visibleLocations.map((loc) => (
              <LocationShape
                key={loc.tempId ?? loc.uuid ?? loc.id}
                location={loc}
                selected={
                  selection.kind === "location" &&
                  selection.id === (loc.tempId ?? loc.uuid)
                }
                readOnly={readOnly}
                onSelect={() =>
                  onSelectionChange({
                    kind: "location",
                    id: loc.tempId ?? loc.uuid,
                  })
                }
                onDragEnd={(x, y) =>
                  onLocationMove(loc.tempId ?? loc.uuid, x, y)
                }
              />
            ))}

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
                listening={false}
              />
            )}
          </Layer>
        </Stage>

        {/* Bottom-right viewport overlay so the user sees current
            zoom level. Easy debug + reassurance. */}
        <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-background/80 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur">
          {Math.round(viewport.scale * 100)}%
        </div>
      </div>
    );
  },
);

// ----------------------------------------------------------------
// Internal shape components

function GridLayer() {
  // Render a sparse grid over the world bounds. We render fewer lines
  // than pixels — Konva is OK with this many shapes (~250) and the
  // grid lives on a non-listening layer so it doesn't affect
  // interaction perf.
  const halfSize = 2500;
  const lines: React.ReactNode[] = [];
  for (let x = -halfSize; x <= halfSize; x += GRID_SIZE * 5) {
    lines.push(
      <Line
        key={`v-${x}`}
        points={[x, -halfSize, x, halfSize]}
        stroke={x === 0 ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.06)"}
        strokeWidth={1}
      />,
    );
  }
  for (let y = -halfSize; y <= halfSize; y += GRID_SIZE * 5) {
    lines.push(
      <Line
        key={`h-${y}`}
        points={[-halfSize, y, halfSize, y]}
        stroke={y === 0 ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.06)"}
        strokeWidth={1}
      />,
    );
  }
  return <>{lines}</>;
}

function WallShape({
  wall,
  selected,
  readOnly,
  onSelect,
}: {
  wall: Wall;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
}) {
  return (
    <Line
      points={[wall.x1, wall.y1, wall.x2, wall.y2]}
      stroke={selected ? "rgb(59,130,246)" : "rgb(45,45,45)"}
      strokeWidth={selected ? 8 : 6}
      lineCap="round"
      onClick={readOnly ? undefined : onSelect}
      onTap={readOnly ? undefined : onSelect}
      hitStrokeWidth={20}
    />
  );
}

function RoomShape({
  room,
  selected,
  readOnly,
  onSelect,
  onDragEnd,
}: {
  room: Room;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
}) {
  return (
    <Group
      x={room.x}
      y={room.y}
      draggable={!readOnly && selected}
      onClick={readOnly ? undefined : onSelect}
      onTap={readOnly ? undefined : onSelect}
      onDragEnd={(e) => {
        const node = e.target;
        const nx = snap(node.x());
        const ny = snap(node.y());
        node.position({ x: nx, y: ny });
        onDragEnd(nx, ny);
      }}
    >
      <Rect
        width={room.width}
        height={room.height}
        fill="rgba(148,163,184,0.18)"
        stroke={selected ? "rgb(59,130,246)" : "rgba(100,116,139,0.6)"}
        strokeWidth={selected ? 2 : 1}
      />
      {room.label && (
        <Text
          text={room.label}
          x={6}
          y={6}
          fontSize={12}
          fill="rgba(51,65,85,0.8)"
        />
      )}
    </Group>
  );
}

function LocationShape({
  location,
  selected,
  readOnly,
  onSelect,
  onDragEnd,
}: {
  location: LocalLocation;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
}) {
  const kindColor: Record<string, { fill: string; stroke: string }> = {
    rack: { fill: "rgba(16,185,129,0.18)", stroke: "rgb(16,185,129)" },
    shelf: { fill: "rgba(59,130,246,0.18)", stroke: "rgb(59,130,246)" },
    pallet_zone: {
      fill: "rgba(245,158,11,0.18)",
      stroke: "rgb(245,158,11)",
    },
    cold_storage: {
      fill: "rgba(14,165,233,0.18)",
      stroke: "rgb(14,165,233)",
    },
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
        const nx = snap(node.x());
        const ny = snap(node.y());
        node.position({ x: nx, y: ny });
        onDragEnd(nx, ny);
      }}
    >
      <Rect
        width={location.width}
        height={location.height}
        fill={palette.fill}
        stroke={selected ? "rgb(59,130,246)" : palette.stroke}
        strokeWidth={selected ? 2.5 : 1.5}
        cornerRadius={4}
      />
      <Text
        text={location.code ? `${location.code}` : location.name || "—"}
        x={6}
        y={6}
        fontSize={11}
        fontStyle="bold"
        fill="rgba(15,23,42,0.85)"
      />
      {location.code && location.name && (
        <Text
          text={location.name}
          x={6}
          y={22}
          fontSize={10}
          fill="rgba(51,65,85,0.7)"
          width={location.width - 12}
          ellipsis
          wrap="none"
        />
      )}
    </Group>
  );
}

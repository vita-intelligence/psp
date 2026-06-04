// Types shared across the canvas editor. Keep these flat + JSON-safe
// so the same shape can ride through the form-channel collab payloads
// in Phase 5 without translation.
//
// Coordinate system: 1 canvas unit = 1 centimetre. All persisted x/y/
// width/height/length values are integers in cm. The UI displays them
// in metres. See `plan-utils.ts` for the conversion helpers.

import type { StorageLocation, StorageLocationKind } from "@/lib/types";

export interface Point {
  /** centimetres in world space (positive right) */
  x: number;
  /** centimetres in world space (positive down) */
  y: number;
}

/** Architectural shape — a wall segment.
 *
 *  By default a wall is a straight line from (x1,y1) to (x2,y2). When
 *  `bow` is set, the wall renders as a quadratic Bezier curve that
 *  passes through `chord midpoint + perpendicular * bow`. Positive
 *  bow curves "to the right" of the chord (after rotating the chord
 *  onto the x axis); negative bows the other way. Undefined or 0 =
 *  straight. Backward compatible — every existing wall reads as
 *  straight because `bow` is optional. */
export interface Wall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Perpendicular sagitta of the arc midpoint relative to the chord,
   *  in centimetres. */
  bow?: number;
}

/** The floor's perimeter polygon — what counts as walkable floor.
 *  `points` is an open list; the renderer closes it implicitly.
 *  Holes are cutouts (e.g. a stairwell on the upper floor) — they
 *  shave area off the polygon visually and conceptually. Each edge
 *  (the segment from points[i] to points[(i+1) % length]) may carry
 *  a perpendicular sagitta in `edgeBows[i]` to bow that edge into a
 *  quadratic Bezier. Missing entries or 0 = straight edge. */
export interface FloorOutline {
  points: Point[];
  /** Parallel to `points`; index i is the bow on the edge starting
   *  at points[i]. Optional + sparse-tolerant: undefined or 0 means
   *  that edge is straight. */
  edgeBows?: number[];
  holes?: Hole[];
}

export interface Hole {
  id: string;
  points: Point[];
  /** Same convention as FloorOutline.edgeBows — perpendicular
   *  sagitta per edge so holes can have curved sides too. */
  edgeBows?: number[];
}

/** Viewport state persisted per floor — re-opening the editor
 *  restores the same pan + zoom the operator left it at. */
export interface Viewport {
  /** Stage position in screen pixels (Konva applies these directly). */
  x: number;
  y: number;
  /** Screen pixels per world centimetre. `0.4` puts ~20 m of world
   *  into a typical ~800px-wide canvas at native zoom — sensible
   *  default for a freshly-created floor. */
  scale: number;
}

/** Full shape of `floor.canvas_json`. Schema is open so the editor
 *  can evolve without backend migrations; the FE always writes the
 *  full blob on save. Phase-4 rooms have been retired — connected
 *  walls define rooms now. */
export interface CanvasJson {
  viewport?: Viewport;
  outline?: FloorOutline;
  walls?: Wall[];
}

export type ToolMode =
  | "select"
  | "pan"
  | "wall"
  | "outline"
  | "hole"
  | "location";

/** One selected element. The outline is a singleton per floor so it
 *  has no id; everything else is addressable. `outline-edge` and
 *  `hole-edge` address one segment of the polygon — clicking an
 *  outline / hole edge picks the edge instead of the whole shape so
 *  the user can bow that single edge. */
export type SelectionItem =
  | { kind: "wall"; id: string }
  | { kind: "outline" }
  | { kind: "outline-edge"; index: number }
  | { kind: "hole"; id: string }
  | { kind: "hole-edge"; holeId: string; index: number }
  | { kind: "location"; id: string };

/** The editor's selection is a SET — shift / ctrl / cmd clicking adds
 *  to it, marquee-drag adds anything intersecting the box, a plain
 *  click replaces. Order is "most recently added at the end" so the
 *  properties panel can prefer the latest pick. */
export type SelectionSet = SelectionItem[];

/** Snap-target candidate surfaced during draw / drag interactions.
 *  When the pointer is within a screen-space threshold of a
 *  candidate, the editor snaps to it and renders a small ring. */
export interface SnapTarget {
  point: Point;
  /** What kind of element supplied the snap point — drives the
   *  indicator colour so the user knows what they're snapping to. */
  source: "wall" | "outline" | "hole";
}

/** Local-only state we add on top of the server `StorageLocation`
 *  rows. New (unsaved) locations get a tempId and have `id: -1` so
 *  the type stays uniform; the save flow translates them to
 *  POST requests. */
export interface LocalLocation extends Omit<StorageLocation, "id"> {
  id: number;
  /** Temp id for newly-drawn locations. Real server-assigned uuids
   *  replace this on save. */
  tempId?: string;
  /** `true` when the row was modified since the last save. */
  dirty?: boolean;
  /** `true` when the user marked it for deletion. We keep the row
   *  around in local state so undo can resurrect it; the save flow
   *  fires DELETE requests for these. */
  deleted?: boolean;
}

export type { StorageLocation, StorageLocationKind };

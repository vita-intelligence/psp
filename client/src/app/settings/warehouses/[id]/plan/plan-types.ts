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

/** Architectural shape — a wall is a straight line segment. Curved
 *  walls land in a follow-up commit; the model gets a `type`
 *  discriminator then. For now every wall is implicitly straight. */
export interface Wall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The floor's perimeter polygon — what counts as walkable floor.
 *  `points` is an open list; the renderer closes it implicitly.
 *  Holes are cutouts (e.g. a stairwell on the upper floor) — they
 *  shave area off the polygon visually and conceptually. */
export interface FloorOutline {
  points: Point[];
  holes?: Hole[];
}

export interface Hole {
  id: string;
  points: Point[];
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

/** What the editor has currently selected. Each kind drives a
 *  different right-side properties form. The outline is a singleton
 *  per floor so it has no id; holes are addressable by id. */
export type Selection =
  | { kind: "none" }
  | { kind: "wall"; id: string }
  | { kind: "outline" }
  | { kind: "hole"; id: string }
  | { kind: "location"; id: string };

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

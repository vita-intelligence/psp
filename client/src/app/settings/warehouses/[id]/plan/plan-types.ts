// Types shared across the canvas editor. Keep these flat + JSON-safe
// so the same shape can ride through the form-channel collab payloads
// in Phase 5 without translation.

import type { StorageLocation, StorageLocationKind } from "@/lib/types";

/** Architectural shape — a wall is a straight line segment. */
export interface Wall {
  /** Client-generated stable id (we generate via crypto.randomUUID
   *  on draw end). Persisted in canvas_json so peers don't need to
   *  re-derive it. */
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Architectural shape — a labelled rectangle. Stored as
 *  top-left + width/height (negative dimensions are normalised on
 *  draw end). */
export interface Room {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

/** Viewport state persisted per floor — re-opening the editor
 *  restores the same pan + zoom the operator left it at. */
export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

/** Full shape of `floor.canvas_json`. Schema is open so the editor
 *  can evolve without backend migrations; the FE always writes the
 *  full blob on save. */
export interface CanvasJson {
  viewport?: Viewport;
  walls?: Wall[];
  rooms?: Room[];
}

export type ToolMode = "select" | "pan" | "wall" | "room" | "location";

/** What the editor has currently selected. Used by the right-side
 *  properties panel to render the right form. Selection is mutually
 *  exclusive — selecting a location deselects any wall, etc. */
export type Selection =
  | { kind: "none" }
  | { kind: "wall"; id: string }
  | { kind: "room"; id: string }
  | { kind: "location"; id: string };

/** Local-only state we add on top of the server `StorageLocation`
 *  rows. New (unsaved) locations get a tempId and have `id: -1` so
 *  the type stays uniform; the save flow translates them to
 *  POST requests. */
export interface LocalLocation extends Omit<StorageLocation, "id"> {
  id: number;
  /** Temp id for newly-drawn locations (negative integer). Real
   *  server-assigned ids are positive. */
  tempId?: string;
  /** `true` when the row was modified since the last save. */
  dirty?: boolean;
  /** `true` when the user marked it for deletion. We keep the row
   *  around in local state so undo can resurrect it; the save flow
   *  fires DELETE requests for these. */
  deleted?: boolean;
}

export type { StorageLocation, StorageLocationKind };

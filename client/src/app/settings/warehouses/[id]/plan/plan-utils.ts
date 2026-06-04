// Helpers shared across the canvas + properties + editor shell.
// Coordinate convention: 1 canvas unit = 1 cm. UI displays in metres.

import type {
  Hole,
  LocalLocation,
  Point,
  SelectionItem,
  SelectionSet,
  SnapTarget,
  Wall,
  FloorOutline,
} from "./plan-types";

export const GRID_MINOR_CM = 50;      // half-metre grid lines
export const GRID_MAJOR_CM = 200;     // 2-metre grid lines
export const SNAP_THRESHOLD_PX = 12;  // screen-pixel radius for endpoint snap
/** Grid snap = 50 cm so every vertex / wall end lands on the visible
 *  minor gridline. Fine adjustment (5 cm and below) is reachable via
 *  direct numeric input in the properties panel — the canvas itself
 *  always feels "snappy" to the half-metre grid. */
export const SNAP_GRID_CM = 50;

/** Snap a centimetre value to the visible 50 cm grid. */
export function snapCm(value: number): number {
  return Math.round(value / SNAP_GRID_CM) * SNAP_GRID_CM;
}

export function snapPoint(p: Point): Point {
  return { x: snapCm(p.x), y: snapCm(p.y) };
}

/** Convert cm → "M.MM m" for display. Numbers under 1 m show "MM cm"
 *  for legibility (a 12cm location reads as "12 cm" not "0.12 m"). */
export function formatLength(cm: number): string {
  const abs = Math.abs(cm);
  if (abs < 100) {
    return `${Math.round(cm)} cm`;
  }
  return `${(cm / 100).toFixed(2)} m`;
}

/**
 * Parse a user-typed dimension into centimetres. Accepts:
 *   "5.5"        → 550 (default unit is metres)
 *   "5.5m"       → 550
 *   "5,5m"       → 550 (European decimals)
 *   "550cm"      → 550
 *   "200 mm"     → 20
 *   ""           → null
 *   "abc"        → null
 * Negative values are clamped to 0.
 */
export function parseDimensionToCm(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase().replace(",", ".");
  if (trimmed.length === 0) return null;

  // Match number + optional unit suffix
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m)?$/);
  if (!match) return null;

  const value = parseFloat(match[1]!);
  if (Number.isNaN(value)) return null;

  const unit = match[2] ?? "m";
  let cm: number;
  switch (unit) {
    case "mm":
      cm = value / 10;
      break;
    case "cm":
      cm = value;
      break;
    case "m":
      cm = value * 100;
      break;
    default:
      return null;
  }
  return Math.max(0, Math.round(cm));
}

/** Inverse of parseDimensionToCm — for input values shown in metres. */
export function cmToMetres(cm: number): number {
  return cm / 100;
}

/** Straight-line distance between the wall's endpoints. For curved
 *  walls this is the chord length, not the arc length — see
 *  `wallArcLengthCm` for the visible-along-the-curve number. */
export function wallChordLengthCm(wall: Wall): number {
  return Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
}

/** Backwards-compatible alias — older callers read this as "the
 *  wall's length" (always treated as chord, which is correct for
 *  straight walls and a sensible default for curves too). */
export const wallLengthCm = wallChordLengthCm;

/** Midpoint of the wall's chord — base for the bow handle. */
export function wallChordMidpoint(wall: Wall): Point {
  return { x: (wall.x1 + wall.x2) / 2, y: (wall.y1 + wall.y2) / 2 };
}

/** Unit perpendicular to the chord, rotated 90° CCW from the chord
 *  direction. Positive bow displaces the handle along this vector. */
export function wallPerpendicular(wall: Wall): Point {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0 };
  // Rotate (dx, dy) by +90°: (−dy, dx), then normalise.
  return { x: -dy / len, y: dx / len };
}

/** Position of the bow handle for a wall — the point on the arc
 *  the user grabs to bend the wall. Sits at
 *  `chord_midpoint + perpendicular * bow`. */
export function wallBowHandle(wall: Wall): Point {
  const m = wallChordMidpoint(wall);
  const p = wallPerpendicular(wall);
  const bow = wall.bow ?? 0;
  return { x: m.x + p.x * bow, y: m.y + p.y * bow };
}

/** Quadratic-Bezier control point that makes the curve pass through
 *  the bow handle at t=0.5. The bezier midpoint sits halfway between
 *  the chord midpoint and the control point, so the control point is
 *  offset by `2 * bow` along the perpendicular. */
export function wallControlPoint(wall: Wall): Point {
  const m = wallChordMidpoint(wall);
  const p = wallPerpendicular(wall);
  const bow = wall.bow ?? 0;
  return { x: m.x + p.x * 2 * bow, y: m.y + p.y * 2 * bow };
}

/** Approximate arc length of a curved wall by sampling the Bezier.
 *  Straight walls fall through to the chord length. 24 samples is
 *  more than enough for centimetre-level display accuracy at the
 *  scales we deal with. */
export function wallArcLengthCm(wall: Wall): number {
  if (!wall.bow || wall.bow === 0) return wallChordLengthCm(wall);
  const c = wallControlPoint(wall);
  const samples = 24;
  let prev: Point = { x: wall.x1, y: wall.y1 };
  let total = 0;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    const p: Point = {
      x: u * u * wall.x1 + 2 * u * t * c.x + t * t * wall.x2,
      y: u * u * wall.y1 + 2 * u * t * c.y + t * t * wall.y2,
    };
    total += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return total;
}

/** Project a candidate handle position onto the perpendicular axis
 *  of the wall to compute the new bow value. Used by the bow-handle
 *  drag. Returns a signed centimetre value (snap applied by caller). */
export function projectBow(wall: Wall, candidate: Point): number {
  const m = wallChordMidpoint(wall);
  const p = wallPerpendicular(wall);
  return (candidate.x - m.x) * p.x + (candidate.y - m.y) * p.y;
}

// ----------------------------------------------------- generic edges
//
// Outline + hole edges share the same bow geometry as walls — the
// helpers below operate on a raw (p1, p2, bow) triple so the same
// math drives walls and polygon edges without duplication.

export function edgeChordMidpoint(p1: Point, p2: Point): Point {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

export function edgePerpendicular(p1: Point, p2: Point): Point {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0 };
  return { x: -dy / len, y: dx / len };
}

export function edgeBowHandle(p1: Point, p2: Point, bow: number): Point {
  const m = edgeChordMidpoint(p1, p2);
  const p = edgePerpendicular(p1, p2);
  return { x: m.x + p.x * bow, y: m.y + p.y * bow };
}

export function edgeControlPoint(p1: Point, p2: Point, bow: number): Point {
  const m = edgeChordMidpoint(p1, p2);
  const p = edgePerpendicular(p1, p2);
  return { x: m.x + p.x * 2 * bow, y: m.y + p.y * 2 * bow };
}

export function edgeChordLengthCm(p1: Point, p2: Point): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

export function edgeArcLengthCm(p1: Point, p2: Point, bow: number): number {
  if (!bow || bow === 0) return edgeChordLengthCm(p1, p2);
  const c = edgeControlPoint(p1, p2, bow);
  const samples = 24;
  let prev: Point = { x: p1.x, y: p1.y };
  let total = 0;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    const sp: Point = {
      x: u * u * p1.x + 2 * u * t * c.x + t * t * p2.x,
      y: u * u * p1.y + 2 * u * t * c.y + t * t * p2.y,
    };
    total += Math.hypot(sp.x - prev.x, sp.y - prev.y);
    prev = sp;
  }
  return total;
}

/** Signed projection of `candidate` onto the edge's perpendicular —
 *  this is the new bow value when dragging the bow handle. */
export function projectEdgeBow(p1: Point, p2: Point, candidate: Point): number {
  const m = edgeChordMidpoint(p1, p2);
  const p = edgePerpendicular(p1, p2);
  return (candidate.x - m.x) * p.x + (candidate.y - m.y) * p.y;
}

/** Clamp `candidate` to the perpendicular axis through the chord
 *  midpoint — used during the bow-handle drag so the user feels a
 *  1-D drag along the bow direction. */
export function projectEdgeHandleAxis(
  p1: Point,
  p2: Point,
  candidate: Point,
): { handle: Point; bow: number } {
  const bow = projectEdgeBow(p1, p2, candidate);
  return { handle: edgeBowHandle(p1, p2, bow), bow };
}

/** Shoelace area of a closed polygon in cm². Positive area = CCW. */
export function polygonAreaCm2(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Perimeter in cm of a closed polygon. */
export function polygonPerimeterCm(points: Point[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Format area: prefers m² above 1 m². */
export function formatArea(cm2: number): string {
  if (cm2 < 10000) return `${Math.round(cm2)} cm²`;
  return `${(cm2 / 10000).toFixed(2)} m²`;
}

/**
 * Collect every snap candidate from the floor's geometry — endpoints
 * of walls plus every outline / hole vertex. Used during draw + drag
 * to make wall ends meet existing geometry cleanly.
 */
export function collectSnapTargets(
  walls: Wall[],
  outline: FloorOutline | undefined,
): SnapTarget[] {
  const targets: SnapTarget[] = [];

  for (const wall of walls) {
    targets.push({ point: { x: wall.x1, y: wall.y1 }, source: "wall" });
    targets.push({ point: { x: wall.x2, y: wall.y2 }, source: "wall" });
  }

  if (outline) {
    for (const p of outline.points) {
      targets.push({ point: { ...p }, source: "outline" });
    }
    for (const hole of outline.holes ?? []) {
      for (const p of hole.points) {
        targets.push({ point: { ...p }, source: "hole" });
      }
    }
  }

  return targets;
}

/**
 * Find the closest snap target to `cursor` within a world-space
 * radius (which the caller derives from screen pixels / current
 * zoom). Returns null if no target is in range.
 */
export function findClosestSnap(
  cursor: Point,
  targets: SnapTarget[],
  worldRadius: number,
): SnapTarget | null {
  let best: SnapTarget | null = null;
  let bestDistSq = worldRadius * worldRadius;
  for (const t of targets) {
    const dx = t.point.x - cursor.x;
    const dy = t.point.y - cursor.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = t;
    }
  }
  return best;
}

/** Normalise a rectangle that was drawn with potentially-negative
 *  width/height (user dragged up-and-left). Returns top-left + size. */
export function normaliseRect(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(x, x + width),
    y: Math.min(y, y + height),
    width: Math.abs(width),
    height: Math.abs(height),
  };
}

// -------------------------------------------------- selection helpers

/** Equality for SelectionItem. The outline is a singleton (no id) so
 *  any two outline items are equal; everything else compares by id
 *  or composite (holeId, index). */
export function selectionEquals(a: SelectionItem, b: SelectionItem): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "outline") return true;
  if (a.kind === "outline-edge") {
    return a.index === (b as { index: number }).index;
  }
  if (a.kind === "hole-edge") {
    const bb = b as { holeId: string; index: number };
    return a.holeId === bb.holeId && a.index === bb.index;
  }
  // Both have an id at this branch — narrowing keeps TS happy.
  return (a as { id: string }).id === (b as { id: string }).id;
}

export function isSelected(set: SelectionSet, item: SelectionItem): boolean {
  return set.some((s) => selectionEquals(s, item));
}

/** Toggle membership of `item` in the selection set. */
export function toggleSelection(
  set: SelectionSet,
  item: SelectionItem,
): SelectionSet {
  if (isSelected(set, item)) {
    return set.filter((s) => !selectionEquals(s, item));
  }
  return [...set, item];
}

/** Union of two selection sets — used when a marquee drag was
 *  additive (shift held). De-duplicates by item identity. */
export function mergeSelections(
  base: SelectionSet,
  add: SelectionSet,
): SelectionSet {
  const result: SelectionSet = [...base];
  for (const item of add) {
    if (!isSelected(result, item)) result.push(item);
  }
  return result;
}

// --------------------------------------------------- bbox + marquee

/** Axis-aligned bounding box. */
export interface Bbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function wallBbox(wall: Wall): Bbox {
  return normaliseRect(wall.x1, wall.y1, wall.x2 - wall.x1, wall.y2 - wall.y1);
}

export function locationBbox(location: LocalLocation): Bbox {
  return { x: location.x, y: location.y, width: location.width, height: location.height };
}

export function polygonBbox(points: Point[]): Bbox | null {
  if (points.length === 0) return null;
  let minX = points[0]!.x;
  let minY = points[0]!.y;
  let maxX = minX;
  let maxY = minY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** True when two axis-aligned boxes overlap at all. */
export function bboxOverlap(a: Bbox, b: Bbox): boolean {
  return !(
    a.x + a.width < b.x ||
    a.x > b.x + b.width ||
    a.y + a.height < b.y ||
    a.y > b.y + b.height
  );
}

/**
 * Find every editable item that overlaps the marquee `box`. Used on
 * marquee drag end to populate the new selection.
 */
export function itemsInMarquee(
  box: Bbox,
  walls: Wall[],
  locations: LocalLocation[],
  outline: FloorOutline | undefined,
): SelectionSet {
  const out: SelectionSet = [];

  // Outline: include when any vertex of the outline polygon is inside
  // the marquee bbox, OR the bbox of the outline overlaps the marquee.
  if (outline && outline.points.length >= 3) {
    const obb = polygonBbox(outline.points);
    if (obb && bboxOverlap(box, obb)) {
      out.push({ kind: "outline" });
    }
  }

  for (const hole of outline?.holes ?? []) {
    const hbb = polygonBbox(hole.points);
    if (hbb && bboxOverlap(box, hbb)) {
      out.push({ kind: "hole", id: hole.id });
    }
  }

  for (const wall of walls) {
    if (bboxOverlap(box, wallBbox(wall))) {
      out.push({ kind: "wall", id: wall.id });
    }
  }

  for (const location of locations) {
    if (location.deleted) continue;
    if (bboxOverlap(box, locationBbox(location))) {
      const id = location.tempId ?? location.uuid;
      out.push({ kind: "location", id });
    }
  }

  return out;
}

// Re-export Hole so utils consumers don't have to import it from
// `plan-types` separately.
export type { Hole };

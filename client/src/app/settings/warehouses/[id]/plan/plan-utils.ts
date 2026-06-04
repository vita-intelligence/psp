// Helpers shared across the canvas + properties + editor shell.
// Coordinate convention: 1 canvas unit = 1 cm. UI displays in metres.

import type { Point, SnapTarget, Wall, FloorOutline } from "./plan-types";

export const GRID_MINOR_CM = 50;      // half-metre grid lines
export const GRID_MAJOR_CM = 200;     // 2-metre grid lines
export const SNAP_THRESHOLD_PX = 12;  // screen-pixel radius for endpoint snap

/** Snap a centimetre value to the nearest 5 cm — small enough to feel
 *  precise, big enough to remove jitter from coarse mouse handling. */
export function snapCm(value: number): number {
  return Math.round(value / 5) * 5;
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

/** Length of a wall in cm. */
export function wallLengthCm(wall: Wall): number {
  return Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
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

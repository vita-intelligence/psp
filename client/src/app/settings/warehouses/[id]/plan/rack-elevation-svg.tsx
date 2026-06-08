"use client";

import { cn } from "@/lib/utils";

interface LevelInput {
  /** UUID for stable React keys + tooltip identity. */
  uuid: string;
  /** 1-based label shown beside the level ("L1", "L2", …). */
  ordinalDisplay: number;
  /** Physical height in metres. `null` = unset, drawn as a dashed
   *  outline so the operator sees it's not finalised yet. */
  height_m: number | null;
  /** Optional max weight for the hover tooltip. */
  max_weight_kg?: number | null;
  width_m?: number | null;
  depth_m?: number | null;
}

interface RackElevationSvgProps {
  /** Levels ordered bottom-up (ordinal ascending). The component
   *  flips the visual stack so the highest ordinal renders at the
   *  top of the SVG — matching the way operators talk about racks. */
  levels: LevelInput[];
  /** Rack's total physical height in metres. When provided, levels
   *  scale against this; otherwise the SVG auto-scales against
   *  Σ heights. */
  totalHeight_m: number | null;
  /** Rendered pixel width — caller decides whether this is a small
   *  thumb (60–80px) or a full panel (200px+). Height is derived. */
  width?: number;
  /** Compact = no labels, no axis, just the stacked bars. Good for
   *  the properties panel thumb. */
  variant?: "thumb" | "full";
  className?: string;
}

/**
 * Side-view of one storage rack, drawn floor-up. Each level is a
 * stacked box scaled by its physical height; unset heights show as
 * dashed outlines so the gap is obvious. If Σ heights exceeds the
 * rack's total, the overshoot is rendered above a dashed total-height
 * line — instant visual feedback that the levels don't fit.
 *
 * Pure presentation — no fetching, no state. Caller is responsible
 * for feeding metres in directly.
 */
export function RackElevationSvg({
  levels,
  totalHeight_m,
  width = 220,
  variant = "full",
  className,
}: RackElevationSvgProps) {
  // Figure out the metres-per-pixel scale. Prefer the rack's own
  // total (operator-declared) so levels read as "how full is the
  // rack" rather than "how big are these arbitrary boxes". Fall
  // back to Σ heights when total isn't set yet.
  const sumHeights = levels.reduce(
    (acc, l) => acc + (l.height_m ?? 0),
    0,
  );
  const heightBudget_m = Math.max(
    totalHeight_m && totalHeight_m > 0 ? totalHeight_m : 0,
    sumHeights,
    // Always show *something* — 1 m minimum keeps an empty rack
    // visible.
    1,
  );

  // Reserve space for axis labels in full variant.
  const axisLeftPx = variant === "full" ? 32 : 8;
  const axisRightPx = variant === "full" ? 56 : 4;
  const padTopPx = variant === "full" ? 10 : 4;
  const padBottomPx = variant === "full" ? 18 : 6;
  const usableWidthPx = Math.max(40, width - axisLeftPx - axisRightPx);
  // Visual height matches physical aspect: 1 m = 60 px when total ≤ 3 m,
  // scaling down for taller racks so the thumb stays reasonable.
  const pxPerMetre = variant === "thumb" ? 24 : 60 / Math.max(1, heightBudget_m / 3);
  const stackHeightPx = heightBudget_m * pxPerMetre;
  const svgHeightPx = stackHeightPx + padTopPx + padBottomPx;

  // Stack from the bottom. Ordinal 0 is the floor level, so we draw
  // levels in render order (bottom-up) and let the y coordinate flip
  // them — y=0 is the SVG top, y=stackHeightPx is the floor.
  let cursor_m = 0;
  const segments = levels.map((level) => {
    const h_m = level.height_m ?? 0;
    const yTop_m = cursor_m + h_m;
    const yBottom_m = cursor_m;
    cursor_m += h_m;
    return {
      level,
      yTopPx: padTopPx + (heightBudget_m - yTop_m) * pxPerMetre,
      yBottomPx: padTopPx + (heightBudget_m - yBottom_m) * pxPerMetre,
      h_m,
      hPx: h_m * pxPerMetre,
      base_m: yBottom_m,
      top_m: yTop_m,
    };
  });

  const overshoot =
    totalHeight_m && totalHeight_m > 0 && sumHeights - totalHeight_m > 0.005
      ? sumHeights - totalHeight_m
      : 0;
  const totalLineYPx =
    totalHeight_m && totalHeight_m > 0
      ? padTopPx + (heightBudget_m - totalHeight_m) * pxPerMetre
      : null;
  const floorYPx = padTopPx + heightBudget_m * pxPerMetre;
  const stackLeftPx = axisLeftPx;
  const stackRightPx = axisLeftPx + usableWidthPx;

  return (
    <svg
      width={width}
      height={svgHeightPx}
      viewBox={`0 0 ${width} ${svgHeightPx}`}
      role="img"
      aria-label={
        levels.length === 0
          ? "Empty rack — no levels defined"
          : `Rack side view, ${levels.length} level${levels.length === 1 ? "" : "s"}`
      }
      className={cn("block", className)}
    >
      {/* Side rails — the two vertical posts of the rack. */}
      <line
        x1={stackLeftPx}
        x2={stackLeftPx}
        y1={padTopPx}
        y2={floorYPx}
        className="stroke-border"
        strokeWidth={1}
      />
      <line
        x1={stackRightPx}
        x2={stackRightPx}
        y1={padTopPx}
        y2={floorYPx}
        className="stroke-border"
        strokeWidth={1}
      />

      {/* Floor line — a thicker baseline so the operator orients
          straight away. */}
      <line
        x1={stackLeftPx - 4}
        x2={stackRightPx + 4}
        y1={floorYPx}
        y2={floorYPx}
        className="stroke-foreground/60"
        strokeWidth={1.5}
      />

      {/* Level rectangles. Unset heights render as dashed outlines
          (h_m === 0 → degenerate, skip). */}
      {segments.map((seg) =>
        seg.h_m > 0 ? (
          <g key={seg.level.uuid}>
            <rect
              x={stackLeftPx + 1}
              y={seg.yTopPx}
              width={usableWidthPx - 2}
              height={seg.hPx}
              className="fill-primary/15 stroke-primary/60"
              strokeWidth={1}
              rx={2}
            >
              <title>
                {`Level ${seg.level.ordinalDisplay} — ${seg.h_m.toFixed(2)} m tall`}
                {seg.level.width_m && seg.level.depth_m
                  ? `\n${seg.level.width_m} × ${seg.level.depth_m} m footprint`
                  : ""}
                {seg.level.max_weight_kg
                  ? `\nMax ${seg.level.max_weight_kg} kg`
                  : ""}
                {`\nSits ${seg.base_m.toFixed(2)} m – ${seg.top_m.toFixed(2)} m above floor`}
              </title>
            </rect>
            {variant === "full" && seg.hPx >= 14 && (
              <text
                x={stackLeftPx + usableWidthPx / 2}
                y={seg.yTopPx + seg.hPx / 2}
                dominantBaseline="middle"
                textAnchor="middle"
                className="fill-foreground text-[10px] font-medium"
              >
                {`L${seg.level.ordinalDisplay} · ${seg.h_m.toFixed(2)} m`}
              </text>
            )}
          </g>
        ) : (
          <rect
            key={seg.level.uuid}
            x={stackLeftPx + 1}
            y={floorYPx - 8}
            width={usableWidthPx - 2}
            height={8}
            className="fill-muted/40 stroke-muted-foreground/40"
            strokeDasharray="3 2"
            strokeWidth={1}
            rx={2}
          >
            <title>{`Level ${seg.level.ordinalDisplay} — height not set`}</title>
          </rect>
        ),
      )}

      {/* Total-height dashed line + label. Only renders when the
          operator declared a rack height. */}
      {totalLineYPx !== null && variant === "full" && (
        <>
          <line
            x1={stackLeftPx - 4}
            x2={stackRightPx + 4}
            y1={totalLineYPx}
            y2={totalLineYPx}
            className={cn(
              "stroke-2",
              overshoot > 0 ? "stroke-destructive" : "stroke-muted-foreground/50",
            )}
            strokeDasharray="4 3"
          />
          <text
            x={stackRightPx + 6}
            y={totalLineYPx}
            dominantBaseline="middle"
            className={cn(
              "text-[9px]",
              overshoot > 0
                ? "fill-destructive font-semibold"
                : "fill-muted-foreground",
            )}
          >
            {`${(totalHeight_m ?? 0).toFixed(2)} m`}
          </text>
        </>
      )}

      {/* Floor label — anchors the "0 m" reading. */}
      {variant === "full" && (
        <text
          x={stackRightPx + 6}
          y={floorYPx}
          dominantBaseline="middle"
          className="fill-muted-foreground text-[9px]"
        >
          0 m
        </text>
      )}

      {/* Left-side ordinal markers, drawn against the floor for each
          level. Drops the marker when there are more than 8 levels
          (label collision). */}
      {variant === "full" &&
        segments.length <= 8 &&
        segments.map((seg) =>
          seg.h_m > 0 ? (
            <text
              key={`mark-${seg.level.uuid}`}
              x={stackLeftPx - 6}
              y={seg.yTopPx + seg.hPx / 2}
              dominantBaseline="middle"
              textAnchor="end"
              className="fill-muted-foreground text-[9px]"
            >
              {`L${seg.level.ordinalDisplay}`}
            </text>
          ) : null,
        )}
    </svg>
  );
}

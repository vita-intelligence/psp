"use client";

import { useId } from "react";

/**
 * Tiny isometric preview of the pack the operator is describing.
 *
 * Used everywhere the system collects pack dimensions + stack factor:
 *
 *   - Goods-In inspection wizard (mobile)
 *   - Production-run Finish dialog (per-pack rows)
 *   - Output-QC partial-fail dialog (parent + child)
 *   - PO receive dialog
 *   - New stock-lot receive form + lot edit + lot packaging card
 *
 * Renders progressively as the operator types:
 *   - 0 dims filled: 3 dashed axis guides from the origin with "—"
 *     labels so the operator can see what L / W / H even refer to.
 *   - 1 dim filled: that axis goes solid + shows the mm value; the
 *     other two stay dashed and labelled "—".
 *   - 2 dims filled: the matching face (front / floor / side) is
 *     drawn as an outline so the operator can read the shape.
 *   - 3 dims filled: full iso box, re-stacked vertically by the
 *     stack factor (capped at 6 for clarity).
 *
 * Pure SVG, brand-coloured via currentColor — fast even on the dock
 * wifi. SVG `<marker>` ids are namespaced via `useId()` so multiple
 * previews on one page (e.g. several FinishDialog packs) don't
 * collide on the global `id` attribute.
 */
export function PackBoxPreview({
  lengthMm,
  widthMm,
  heightMm,
  stack,
}: {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  stack: number;
}) {
  const reactId = useId();
  const solidId = `pack-arrow-solid-${reactId}`;
  const ghostId = `pack-arrow-ghost-${reactId}`;

  const hasW = widthMm > 0;
  const hasL = lengthMm > 0;
  const hasH = heightMm > 0;
  const allFilled = hasW && hasL && hasH;
  const anyFilled = hasW || hasL || hasH;
  const stackN = Math.max(1, Math.min(Math.round(stack || 1), 6));
  const stackOverflow = (stack || 1) > 6;
  const effectiveStack = allFilled ? stackN : 1;

  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);

  const filledMax = Math.max(widthMm, lengthMm, heightMm);
  const baseScale = filledMax > 0 ? 65 / filledMax : 0.13;
  const fallbackLen = filledMax > 0 ? filledMax * baseScale * 0.55 : 40;

  let w = hasW ? widthMm * baseScale : fallbackLen;
  let h = hasH ? heightMm * baseScale : fallbackLen;
  let d = hasL ? lengthMm * baseScale : fallbackLen;
  let ix = d * cos30 * 0.55;
  let iy = d * sin30 * 0.55;

  const maxColumnH = 115;
  const columnH = h * effectiveStack + iy;
  if (columnH > maxColumnH) {
    const f = maxColumnH / columnH;
    w *= f;
    h *= f;
    ix *= f;
    iy *= f;
  }

  const padX = 22;
  const padY = 22;
  const svgW = w + ix + padX * 2;
  const svgH = h * effectiveStack + iy + padY * 2;
  const originX = padX;
  const originY = svgH - padY;

  const wTipX = originX + w;
  const wTipY = originY;
  const hTipX = originX;
  const hTipY = originY - h * effectiveStack;
  const lTipX = originX + ix;
  const lTipY = originY - iy;

  return (
    <div className="rounded-md border border-border/60 bg-muted/10 p-2">
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Pack preview
        </span>
        <span className="text-[10px] text-muted-foreground/80 tabular-nums">
          {hasL ? lengthMm : "—"} × {hasW ? widthMm : "—"} ×{" "}
          {hasH ? heightMm : "—"} mm
          {allFilled && stackN > 1 ? ` · stack ${stack}` : ""}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="mx-auto block h-32 w-full text-brand"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <marker
            id={solidId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
          <marker
            id={ghostId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" fillOpacity="0.4" />
          </marker>
        </defs>

        {/* Full iso box (only when all three dims are known) */}
        {allFilled &&
          Array.from({ length: effectiveStack }, (_, i) => {
            const yBase = originY - i * h;
            const yTop = yBase - h;
            const front = `M${originX},${yBase} L${originX + w},${yBase} L${originX + w},${yTop} L${originX},${yTop} Z`;
            const top = `M${originX},${yTop} L${originX + w},${yTop} L${originX + w + ix},${yTop - iy} L${originX + ix},${yTop - iy} Z`;
            const right = `M${originX + w},${yBase} L${originX + w + ix},${yBase - iy} L${originX + w + ix},${yTop - iy} L${originX + w},${yTop} Z`;
            return (
              <g key={i}>
                <path
                  d={right}
                  fill="currentColor"
                  fillOpacity="0.45"
                  stroke="currentColor"
                  strokeOpacity="0.75"
                  strokeWidth="0.75"
                />
                <path
                  d={top}
                  fill="currentColor"
                  fillOpacity="0.3"
                  stroke="currentColor"
                  strokeOpacity="0.75"
                  strokeWidth="0.75"
                />
                <path
                  d={front}
                  fill="currentColor"
                  fillOpacity="0.65"
                  stroke="currentColor"
                  strokeOpacity="0.85"
                  strokeWidth="0.75"
                />
              </g>
            );
          })}

        {/* 2-of-3 face hints */}
        {!allFilled && hasW && hasH && !hasL && (
          <path
            d={`M${originX},${originY} L${originX + w},${originY} L${originX + w},${originY - h} L${originX},${originY - h} Z`}
            fill="currentColor"
            fillOpacity="0.18"
            stroke="currentColor"
            strokeOpacity="0.7"
            strokeWidth="1"
          />
        )}
        {!allFilled && hasW && hasL && !hasH && (
          <path
            d={`M${originX},${originY} L${originX + w},${originY} L${originX + w + ix},${originY - iy} L${originX + ix},${originY - iy} Z`}
            fill="currentColor"
            fillOpacity="0.18"
            stroke="currentColor"
            strokeOpacity="0.7"
            strokeWidth="1"
          />
        )}
        {!allFilled && hasL && hasH && !hasW && (
          <path
            d={`M${originX},${originY} L${originX + ix},${originY - iy} L${originX + ix},${originY - h - iy} L${originX},${originY - h} Z`}
            fill="currentColor"
            fillOpacity="0.18"
            stroke="currentColor"
            strokeOpacity="0.7"
            strokeWidth="1"
          />
        )}

        {/* Axis guides */}
        <line
          x1={originX}
          y1={originY}
          x2={wTipX}
          y2={wTipY}
          stroke="currentColor"
          strokeWidth={hasW ? "1.25" : "1"}
          strokeOpacity={hasW ? "0.95" : "0.45"}
          strokeDasharray={hasW ? "" : "3 3"}
          markerEnd={hasW ? `url(#${solidId})` : `url(#${ghostId})`}
        />
        <line
          x1={originX}
          y1={originY}
          x2={hTipX}
          y2={hTipY}
          stroke="currentColor"
          strokeWidth={hasH ? "1.25" : "1"}
          strokeOpacity={hasH ? "0.95" : "0.45"}
          strokeDasharray={hasH ? "" : "3 3"}
          markerEnd={hasH ? `url(#${solidId})` : `url(#${ghostId})`}
        />
        <line
          x1={originX}
          y1={originY}
          x2={lTipX}
          y2={lTipY}
          stroke="currentColor"
          strokeWidth={hasL ? "1.25" : "1"}
          strokeOpacity={hasL ? "0.95" : "0.45"}
          strokeDasharray={hasL ? "" : "3 3"}
          markerEnd={hasL ? `url(#${solidId})` : `url(#${ghostId})`}
        />

        <circle
          cx={originX}
          cy={originY}
          r="1.8"
          fill="currentColor"
          fillOpacity="0.85"
        />

        <text
          x={originX + w / 2}
          y={originY + 13}
          textAnchor="middle"
          fontSize="9"
          fill="currentColor"
          fillOpacity={hasW ? "0.95" : "0.55"}
        >
          W {hasW ? widthMm : "—"}
        </text>
        <text
          x={lTipX + 4}
          y={lTipY - 2}
          textAnchor="start"
          fontSize="9"
          fill="currentColor"
          fillOpacity={hasL ? "0.95" : "0.55"}
        >
          L {hasL ? lengthMm : "—"}
        </text>
        <text
          x={originX - 4}
          y={originY - (h * effectiveStack) / 2 + 3}
          textAnchor="end"
          fontSize="9"
          fill="currentColor"
          fillOpacity={hasH ? "0.95" : "0.55"}
        >
          H {hasH ? heightMm : "—"}
          {allFilled && effectiveStack > 1 ? `×${effectiveStack}` : ""}
        </text>
      </svg>
      {!anyFilled && (
        <p className="px-1 pt-1 text-[10px] text-muted-foreground">
          Type any dimension to see it appear.
        </p>
      )}
      {stackOverflow && allFilled && (
        <p className="px-1 pt-1 text-[10px] text-amber-700 dark:text-amber-300">
          Stack factor {stack} — preview is capped at 6 for clarity.
        </p>
      )}
    </div>
  );
}

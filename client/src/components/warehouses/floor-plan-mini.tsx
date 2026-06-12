"use client";

import { useEffect, useState } from "react";
import { Loader2, MapPin } from "lucide-react";

interface PlanLocation {
  id: number;
  uuid: string;
  name: string | null;
  code: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string | null;
}

interface Wall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface FloorOutline {
  points: { x: number; y: number }[];
}

interface CanvasJson {
  outline?: FloorOutline;
  walls?: Wall[];
}

interface FloorPlan {
  floor: {
    uuid: string;
    name: string;
    canvas_json?: CanvasJson;
  };
  locations: PlanLocation[];
}

interface Props {
  floorUuid: string;
  /** Location to highlight + pin. */
  targetLocationUuid: string;
  /**
   * Where to fetch the floor plan from. Two auth contexts ship today:
   *   * `/api/m/floors/<uuid>/plan` — device cookie (mobile shell)
   *   * `/api/stock/floors/<uuid>/plan` — session cookie (desktop)
   * Caller picks the right one for its auth context.
   */
  apiPath: (floorUuid: string) => string;
  /** Footer caption — explains what the pin means in context.
   *  Defaults to the mobile copy ("pinned rack is your destination"). */
  footerLabel?: string;
  /** Override the rendered height. Default 18rem matches the mobile
   *  directions card; the desktop placements card uses a slimmer
   *  10rem to keep the row compact when expanded. */
  heightClassName?: string;
}

/**
 * Floor-plan thumbnail. Renders the outline polygon + walls + every
 * location so the viewer orients against the whole floor; the target
 * rack is filled brand colour with a thick outline + pin marker so
 * the eye snaps to it instantly.
 *
 * Used by both the mobile move-flow ("walk to") and the desktop lot
 * placements card. The only thing that changes between contexts is
 * the API path + auth — same SVG geometry, same hit-target.
 */
export function FloorPlanMini({
  floorUuid,
  targetLocationUuid,
  apiPath,
  footerLabel,
  heightClassName,
}: Props) {
  const [data, setData] = useState<FloorPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiPath(floorUuid));
        if (!res.ok) throw new Error("not_found");
        const json = (await res.json()) as FloorPlan;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError("Couldn't load the floor plan.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [floorUuid, apiPath]);

  if (error) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-border/60 bg-muted/40">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const outline = data.floor.canvas_json?.outline?.points ?? [];
  const walls = data.floor.canvas_json?.walls ?? [];

  if (data.locations.length === 0 && outline.length === 0 && walls.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground">
        No floor plan drawn yet.
      </div>
    );
  }

  // Bounding box across every drawn thing on the floor so the mini
  // shows the whole layout, not a tight crop of just the racks.
  const xs: number[] = [];
  const ys: number[] = [];
  data.locations.forEach((l) => {
    xs.push(l.x, l.x + l.width);
    ys.push(l.y, l.y + l.height);
  });
  outline.forEach((p) => {
    xs.push(p.x);
    ys.push(p.y);
  });
  walls.forEach((w) => {
    xs.push(w.x1, w.x2);
    ys.push(w.y1, w.y2);
  });

  const PAD = 80;
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  const maxX = Math.max(...xs) + PAD;
  const maxY = Math.max(...ys) + PAD;
  const vbW = Math.max(1, maxX - minX);
  const vbH = Math.max(1, maxY - minY);

  const outlinePoints = outline.map((p) => `${p.x},${p.y}`).join(" ");
  const labelFont = Math.max(20, Math.min(vbW, vbH) * 0.03);

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/30">
      <svg
        viewBox={`${minX} ${minY} ${vbW} ${vbH}`}
        className={`block w-full ${heightClassName ?? "h-72"}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {outline.length >= 3 && (
          <polygon
            points={outlinePoints}
            fill="rgba(240, 240, 245, 0.9)"
            stroke="rgba(60,60,75,0.6)"
            strokeWidth={Math.max(2, vbW / 350)}
            strokeLinejoin="round"
          />
        )}

        {walls.map((w) => (
          <line
            key={w.id}
            x1={w.x1}
            y1={w.y1}
            x2={w.x2}
            y2={w.y2}
            stroke="rgba(20,20,30,0.85)"
            strokeWidth={Math.max(4, vbW / 220)}
            strokeLinecap="round"
          />
        ))}

        {data.locations.map((loc) => {
          const isTarget = loc.uuid === targetLocationUuid;
          const label = loc.code || loc.name || `#${loc.id}`;
          return (
            <g key={loc.uuid}>
              <rect
                x={loc.x}
                y={loc.y}
                width={loc.width}
                height={loc.height}
                rx={6}
                ry={6}
                fill={isTarget ? "var(--brand)" : "rgba(120,120,135,0.18)"}
                fillOpacity={isTarget ? 0.85 : 1}
                stroke={isTarget ? "var(--brand)" : "rgba(80,80,95,0.45)"}
                strokeWidth={
                  isTarget ? Math.max(6, vbW / 140) : Math.max(2, vbW / 320)
                }
              />
              <text
                x={loc.x + loc.width / 2}
                y={loc.y + loc.height / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                className="select-none"
                style={{
                  fontSize: labelFont,
                  fontWeight: isTarget ? 700 : 500,
                  fill: isTarget ? "#fff" : "rgba(40,40,55,0.85)",
                }}
              >
                {label}
              </text>
            </g>
          );
        })}

        {(() => {
          const target = data.locations.find(
            (l) => l.uuid === targetLocationUuid,
          );
          if (!target) return null;
          const cx = target.x + target.width / 2;
          const top = target.y;
          const pinR = Math.max(20, vbW / 80);
          return (
            <g transform={`translate(${cx}, ${top - pinR})`}>
              <circle
                r={pinR}
                fill="white"
                stroke="var(--brand)"
                strokeWidth={pinR * 0.35}
              />
              <circle r={pinR * 0.4} fill="var(--brand)" />
            </g>
          );
        })()}
      </svg>
      <div className="flex items-center gap-1.5 border-t border-border/60 bg-card px-3 py-2 text-xs text-muted-foreground">
        <MapPin className="size-3.5 text-brand" />
        <span>
          {data.floor.name} — {footerLabel ?? "pinned rack is your destination."}
        </span>
      </div>
    </div>
  );
}

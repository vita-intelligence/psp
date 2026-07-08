"use client";

/**
 * Production routemap — compact SVG flow diagram showing how a CO
 * travels through production. Rendered on the Project Control Board
 * above the session-story timeline so the room has a shared mental
 * model of "where are we, where are we going".
 *
 * Layers (left → right):
 *
 *   CO  →  MO(s) stacked vertically  →  workstation groups per MO
 *                                       (chronological, left→right)  →  Dispatch
 *
 * State comes from three sources, in priority order:
 *
 *   1. `wizard.phase.key` — the CO-level phase; highlights which
 *      column the room is "in right now".
 *   2. `mo.status` — per-MO chip (draft / prepared / scheduled /
 *      in_progress / completed / cancelled).
 *   3. `sessions` — count per (mo × workstation_group) inferred from
 *      the manufacturing_order_step foreign key; a group that has
 *      an active session gets an "in progress" tone.
 *
 * The wizard snapshot does NOT include per-MO workstation_group
 * steps (only status counters). So groups are derived from the
 * session history — if operators have clocked in on a group, we
 * know it exists in the route. If not yet, the MO row degrades to a
 * single "not started" pill.
 *
 * Defensive: if `wizard` is null or the snapshot shape is off, the
 * component renders a friendly fallback rather than throwing.
 */

import { Route } from "lucide-react";
import type {
  CompanyDefaults,
  CustomerOrder,
  OrderWizardMo,
  OrderWizardMoStatus,
  OrderWizardPhaseKey,
  OrderWizardSnapshot,
} from "@/lib/types";
import { formatCompanyNumber } from "@/lib/format/company";
import type { WorkstationSessionRow } from "@/lib/production/sessions";
import { cn } from "@/lib/utils";

export interface ProductionRoutemapProps {
  co: CustomerOrder;
  wizard: OrderWizardSnapshot | null;
  sessions: WorkstationSessionRow[];
  prefs: CompanyDefaults;
}

// -----------------------------------------------------------------------------
// State tones — mirrored to the session-story pills so the two panels look
// like one story. Slate = pending, amber = active, emerald = done,
// red = blocked/cancelled.
// -----------------------------------------------------------------------------

type NodeState = "done" | "active" | "pending" | "blocked";

const NODE_TONE: Record<
  NodeState,
  { fill: string; stroke: string; text: string; chipBg: string; chipText: string }
> = {
  done: {
    fill: "fill-emerald-500/10",
    stroke: "stroke-emerald-500/60",
    text: "fill-emerald-800 dark:fill-emerald-300",
    chipBg: "fill-emerald-500/15",
    chipText: "fill-emerald-800 dark:fill-emerald-300",
  },
  active: {
    fill: "fill-amber-500/10",
    stroke: "stroke-amber-500/60",
    text: "fill-amber-800 dark:fill-amber-300",
    chipBg: "fill-amber-500/15",
    chipText: "fill-amber-800 dark:fill-amber-300",
  },
  pending: {
    fill: "fill-muted",
    stroke: "stroke-border",
    text: "fill-muted-foreground",
    chipBg: "fill-background",
    chipText: "fill-muted-foreground",
  },
  blocked: {
    fill: "fill-red-500/10",
    stroke: "stroke-red-500/60",
    text: "fill-red-800 dark:fill-red-300",
    chipBg: "fill-red-500/15",
    chipText: "fill-red-800 dark:fill-red-300",
  },
};

// MO status → node state — the wizard's OrderWizardMoStatus doesn't map 1:1
// to our four buckets, so squash conservatively.
function statusToState(status: OrderWizardMoStatus): NodeState {
  switch (status) {
    case "completed":
      return "done";
    case "in_progress":
      return "active";
    case "cancelled":
      return "blocked";
    default:
      return "pending";
  }
}

// Phase key → column highlighting. Anything "in_production"-ish highlights
// the MO+Workstation columns; closeout+ moves the emphasis to Dispatch.
const PRODUCTION_PHASES: OrderWizardPhaseKey[] = [
  "production_planning",
  "awaiting_ingredients",
  "in_production",
];
const DISPATCH_PHASES: OrderWizardPhaseKey[] = [
  "closeout",
  "final_release",
  "awaiting_routing",
  "ready_to_dispatch",
  "awaiting_pickup",
  "dispatched",
  "delivered",
];

function coColumnState(phase: OrderWizardPhaseKey | undefined): NodeState {
  if (!phase) return "pending";
  if (phase === "cancelled") return "blocked";
  if (phase === "setup" || phase === "approval") return "active";
  return "done";
}

function mosColumnState(phase: OrderWizardPhaseKey | undefined): NodeState {
  if (!phase) return "pending";
  if (phase === "cancelled") return "blocked";
  if (PRODUCTION_PHASES.includes(phase)) return "active";
  if (DISPATCH_PHASES.includes(phase) || phase === "delivered") return "done";
  return "pending";
}

function dispatchColumnState(phase: OrderWizardPhaseKey | undefined): NodeState {
  if (!phase) return "pending";
  if (phase === "delivered") return "done";
  if (phase === "cancelled") return "blocked";
  if (DISPATCH_PHASES.includes(phase)) return "active";
  return "pending";
}

// -----------------------------------------------------------------------------
// Layout constants — everything scales off these so the whole diagram
// fits the standard 800px viewBox width. Heights auto-fit to row count.
// -----------------------------------------------------------------------------

const VIEW_W = 800;
const COL_X = { co: 40, mo: 240, ws: 460, dispatch: 700 };
const NODE_W = { co: 160, mo: 180, ws: 150, dispatch: 90 };
const NODE_H = 46;
const MO_ROW_GAP = 22; // vertical gap between MO rows
const WS_ROW_GAP = 12; // vertical gap between workstation nodes within a row
const PADDING_Y = 28;

// -----------------------------------------------------------------------------
// Session bucketing — build a map of MO uuid → workstation_group_name →
// { sessionCount, hasActive }. Sessions without a workstation_group_name
// or without a manufacturing_order_uuid are ignored (they belong to
// cleaning/maintenance or ad-hoc slots, not the routemap).
// -----------------------------------------------------------------------------

interface WsBucket {
  name: string;
  count: number;
  hasActive: boolean;
}

function bucketSessionsByMo(
  sessions: WorkstationSessionRow[],
): Map<string, WsBucket[]> {
  const perMo = new Map<string, Map<string, WsBucket>>();
  for (const s of sessions) {
    const step = s.manufacturing_order_step;
    const moUuid = step?.manufacturing_order_uuid;
    const wsName = step?.workstation_group_name;
    if (!moUuid || !wsName) continue;
    let byWs = perMo.get(moUuid);
    if (!byWs) {
      byWs = new Map();
      perMo.set(moUuid, byWs);
    }
    const existing = byWs.get(wsName);
    if (existing) {
      existing.count += 1;
      if (s.status === "active") existing.hasActive = true;
    } else {
      byWs.set(wsName, {
        name: wsName,
        count: 1,
        hasActive: s.status === "active",
      });
    }
  }
  // Preserve first-seen order per MO (sessions come newest-first from the
  // server, so reverse to get earliest-first — reads left→right as a story).
  const out = new Map<string, WsBucket[]>();
  for (const [moUuid, byWs] of perMo) {
    out.set(moUuid, Array.from(byWs.values()).reverse());
  }
  return out;
}

// Flatten wizard MOs across lines + top-level `mos` (dedup by uuid) so the
// routemap draws each MO exactly once regardless of whether the wizard
// surfaces it via line.mos or the flat mos array.
function collectMos(wizard: OrderWizardSnapshot): OrderWizardMo[] {
  const seen = new Set<string>();
  const out: OrderWizardMo[] = [];
  const visit = (mo: OrderWizardMo) => {
    if (seen.has(mo.uuid)) return;
    seen.add(mo.uuid);
    out.push(mo);
    (mo.children ?? []).forEach(visit);
  };
  wizard.lines?.forEach((line) => {
    line.mos?.forEach(visit);
    if (line.primary_mo) visit(line.primary_mo);
  });
  wizard.mos?.forEach(visit);
  return out;
}

// -----------------------------------------------------------------------------
// Sub-components — all local, keep the file self-contained.
// -----------------------------------------------------------------------------

interface NodeRectProps {
  x: number;
  y: number;
  w: number;
  h: number;
  state: NodeState;
  title: string;
  subtitle?: string;
  showPulse?: boolean;
}

function NodeRect({
  x,
  y,
  w,
  h,
  state,
  title,
  subtitle,
  showPulse,
}: NodeRectProps) {
  const tone = NODE_TONE[state];
  const cx = x + w - 8;
  const cy = y + 8;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        ry={8}
        className={cn(tone.fill, tone.stroke)}
        strokeWidth={1.25}
      />
      <text
        x={x + 10}
        y={y + (subtitle ? 20 : h / 2 + 4)}
        className={cn("text-[11px] font-semibold", tone.text)}
        style={{ fontFamily: "inherit" }}
      >
        {truncateForSvg(title, Math.floor((w - 20) / 6))}
      </text>
      {subtitle && (
        <text
          x={x + 10}
          y={y + 34}
          className={cn("text-[10px]", tone.text)}
          style={{ fontFamily: "inherit", opacity: 0.75 }}
        >
          {truncateForSvg(subtitle, Math.floor((w - 20) / 5))}
        </text>
      )}
      {showPulse && (
        <circle
          cx={cx}
          cy={cy}
          r={4}
          className="fill-emerald-500"
        >
          <animate
            attributeName="opacity"
            values="1;0.3;1"
            dur="1.6s"
            repeatCount="indefinite"
          />
        </circle>
      )}
    </g>
  );
}

/** SVG-safe text truncation — no font metrics available at SSR, so we
 *  eyeball char-per-pixel and clip. Not perfect but close enough at the
 *  small font sizes we render. */
function truncateForSvg(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(1, maxChars - 1))}…`;
}

interface EdgeProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  state: NodeState;
}

/** Curved edge — cubic Bézier with horizontal handles so the line
 *  eases in/out of the source/target rects. */
function Edge({ fromX, fromY, toX, toY, state }: EdgeProps) {
  const dx = Math.max(30, (toX - fromX) / 2);
  const path = `M ${fromX} ${fromY} C ${fromX + dx} ${fromY}, ${toX - dx} ${toY}, ${toX} ${toY}`;
  const stroke =
    state === "active"
      ? "stroke-amber-500/70"
      : state === "done"
        ? "stroke-emerald-500/50"
        : state === "blocked"
          ? "stroke-red-500/60"
          : "stroke-border";
  return (
    <path
      d={path}
      fill="none"
      className={stroke}
      strokeWidth={1.5}
      strokeLinecap="round"
    />
  );
}

// -----------------------------------------------------------------------------
// Empty / fallback states
// -----------------------------------------------------------------------------

function RoutemapFallback({ message }: { message: string }) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <Route className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight">Production route</h2>
      </header>
      <p className="text-xs text-muted-foreground">{message}</p>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------------

export function ProductionRoutemap({
  wizard,
  sessions,
  prefs,
}: ProductionRoutemapProps) {
  if (!wizard || typeof wizard !== "object" || !("phase" in wizard)) {
    return (
      <RoutemapFallback message="Routemap unavailable — wizard snapshot missing." />
    );
  }

  const mos = collectMos(wizard);

  if (mos.length === 0) {
    return (
      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="mb-3 flex items-center gap-2">
          <Route className="size-4 text-muted-foreground" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              Production route
            </h2>
            <p className="text-[11px] text-muted-foreground">
              How this order flows through production
            </p>
          </div>
        </header>
        <div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-4 text-center">
          <p className="mx-auto max-w-md text-xs text-muted-foreground">
            No MOs planned yet — production route appears once MOs are created.
          </p>
        </div>
      </section>
    );
  }

  const phaseKey = wizard.phase?.key;
  const sessionsByMo = bucketSessionsByMo(sessions);

  // Row height per MO = max(NODE_H, ws stack). Compute geometry so the
  // viewBox scales to content — no fixed height, no scrolling inside.
  const moRowHeights = mos.map((mo) => {
    const ws = sessionsByMo.get(mo.uuid) ?? [];
    const wsStackH =
      ws.length === 0
        ? NODE_H
        : ws.length * NODE_H + (ws.length - 1) * WS_ROW_GAP;
    return Math.max(NODE_H, wsStackH);
  });

  const totalH =
    PADDING_Y * 2 +
    moRowHeights.reduce((a, h) => a + h, 0) +
    Math.max(0, mos.length - 1) * MO_ROW_GAP;

  const coState = coColumnState(phaseKey);
  // `mosColumnState` is referenced conceptually via per-MO tinting below;
  // keep the helper exported for callers that render a compact summary.
  void mosColumnState;
  const dispatchState = dispatchColumnState(phaseKey);

  // Centre the CO node vertically against the whole MO stack so the
  // fan-out edges look balanced.
  const contentTop = PADDING_Y;
  const contentBottom = totalH - PADDING_Y;
  const coY = (contentTop + contentBottom) / 2 - NODE_H / 2;
  const dispatchY = coY;

  // Precompute per-MO row Y (top edge of the row) and the vertical
  // centre of each MO node inside its row. Built via reduce so we don't
  // reassign a `let` after render — keeps the react-hooks/immutability
  // rule happy while remaining O(n).
  const moRowTop = moRowHeights.reduce<number[]>((acc, _h, i) => {
    if (i === 0) acc.push(PADDING_Y);
    else acc.push(acc[i - 1] + moRowHeights[i - 1] + MO_ROW_GAP);
    return acc;
  }, []);
  const moRowY = moRowHeights.map(
    (h, i) => moRowTop[i] + (h - NODE_H) / 2,
  );

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center gap-2">
        <Route className="size-4 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight">Production route</h2>
          <p className="text-[11px] text-muted-foreground">
            How this order flows through production
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {formatCompanyNumber(mos.length, prefs)} MO
          {mos.length === 1 ? "" : "s"}
        </span>
      </header>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${VIEW_W} ${totalH}`}
          role="img"
          aria-label="Production route diagram"
          className="w-full min-w-[640px]"
          style={{ height: totalH }}
        >
          {/* --- Edges (drawn first so nodes overlap them cleanly) --- */}
          {mos.map((mo, i) => {
            const moY = moRowY[i] + NODE_H / 2;
            const moState = statusToState(mo.status);
            const ws = sessionsByMo.get(mo.uuid) ?? [];
            const rowTop = moRowTop[i];
            const rowH = moRowHeights[i];
            return (
              <g key={`edges-${mo.uuid}`}>
                {/* CO → MO */}
                <Edge
                  fromX={COL_X.co + NODE_W.co}
                  fromY={coY + NODE_H / 2}
                  toX={COL_X.mo}
                  toY={moY}
                  state={moState}
                />
                {/* MO → each WS (or straight to Dispatch if no WS) */}
                {ws.length === 0 ? (
                  <Edge
                    fromX={COL_X.mo + NODE_W.mo}
                    fromY={moY}
                    toX={COL_X.dispatch}
                    toY={dispatchY + NODE_H / 2}
                    state={moState}
                  />
                ) : (
                  ws.map((_, j) => {
                    const wsY =
                      rowTop + j * (NODE_H + WS_ROW_GAP) + NODE_H / 2;
                    const wsState = ws[j].hasActive
                      ? "active"
                      : moState === "done"
                        ? "done"
                        : "pending";
                    return (
                      <g key={`ws-edges-${mo.uuid}-${j}`}>
                        <Edge
                          fromX={COL_X.mo + NODE_W.mo}
                          fromY={moY}
                          toX={COL_X.ws}
                          toY={wsY}
                          state={wsState}
                        />
                        <Edge
                          fromX={COL_X.ws + NODE_W.ws}
                          fromY={wsY}
                          toX={COL_X.dispatch}
                          toY={dispatchY + NODE_H / 2}
                          state={wsState}
                        />
                      </g>
                    );
                  })
                )}
                {/* Suppress unused rowH warning while keeping the intent
                    explicit for future edits. */}
                {rowH < 0 && null}
              </g>
            );
          })}

          {/* --- CO node --- */}
          <NodeRect
            x={COL_X.co}
            y={coY}
            w={NODE_W.co}
            h={NODE_H}
            state={coState}
            title={`CO ${wizard.customer_order?.code ?? ""}`.trim() || "Customer order"}
            subtitle={wizard.phase?.label ?? undefined}
            showPulse={
              coState === "active" &&
              (phaseKey === "setup" || phaseKey === "approval")
            }
          />

          {/* --- MO nodes + WS nodes --- */}
          {mos.map((mo, i) => {
            const moY = moRowY[i];
            const moState = statusToState(mo.status);
            const ws = sessionsByMo.get(mo.uuid) ?? [];
            const rowTop = moRowTop[i];
            const isCurrentMoPhase =
              phaseKey && PRODUCTION_PHASES.includes(phaseKey);
            return (
              <g key={`nodes-${mo.uuid}`}>
                <NodeRect
                  x={COL_X.mo}
                  y={moY}
                  w={NODE_W.mo}
                  h={NODE_H}
                  state={moState}
                  title={mo.code ?? `MO #${mo.id}`}
                  subtitle={mo.item_name ?? undefined}
                  showPulse={moState === "active"}
                />
                {ws.map((bucket, j) => {
                  const wsY = rowTop + j * (NODE_H + WS_ROW_GAP);
                  const wsState: NodeState = bucket.hasActive
                    ? "active"
                    : moState === "done"
                      ? "done"
                      : "pending";
                  return (
                    <NodeRect
                      key={`ws-${mo.uuid}-${bucket.name}-${j}`}
                      x={COL_X.ws}
                      y={wsY}
                      w={NODE_W.ws}
                      h={NODE_H}
                      state={wsState}
                      title={bucket.name}
                      subtitle={`${bucket.count} session${bucket.count === 1 ? "" : "s"}`}
                      showPulse={
                        bucket.hasActive && Boolean(isCurrentMoPhase)
                      }
                    />
                  );
                })}
              </g>
            );
          })}

          {/* --- Dispatch node --- */}
          <NodeRect
            x={COL_X.dispatch}
            y={dispatchY}
            w={NODE_W.dispatch}
            h={NODE_H}
            state={dispatchState}
            title="Dispatch"
            subtitle={
              phaseKey === "delivered"
                ? "Delivered"
                : dispatchState === "active"
                  ? wizard.phase?.label
                  : undefined
            }
            showPulse={dispatchState === "active"}
          />
        </svg>
      </div>

      {/* --- Legend --- */}
      <ul
        className="mt-3 flex flex-wrap items-center gap-4 border-t border-border/40 pt-3 text-[11px] text-muted-foreground"
        aria-label="Route status legend"
      >
        <LegendDot color="bg-emerald-500" label="Done" />
        <LegendDot color="bg-amber-500" label="In progress" />
        <LegendDot color="bg-muted-foreground/40" label="Pending" />
        <LegendDot color="bg-red-500" label="Blocked" />
      </ul>
    </section>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block size-2 rounded-full", color)} aria-hidden />
      {label}
    </li>
  );
}

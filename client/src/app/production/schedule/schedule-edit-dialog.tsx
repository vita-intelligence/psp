"use client";

/**
 * Click-to-edit dialog for calendar blocks. Three variants:
 *
 *   project — the chain root. Lists every MO in the chain and every
 *             operation inside each MO.
 *   mo      — single MO. Lists every operation inside it.
 *   step    — single operation.
 *
 * Each operation row is split into work segments with the pauses
 * between them shown as their own rows. When the BE has stored
 * `planned_segments`, those are the literal source; otherwise the
 * client-side walker derives segments from
 * `planned_start + planned_duration_seconds + working_intervals` so
 * the dialog opens populated even for ops that were never manually
 * pinned.
 *
 * Phase B: read-only render. Phase C wires editing + realtime
 * collab + Save → POST /steps/:id/set-segments.
 */

import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import Link from "next/link";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCompanyDate } from "@/lib/format/company";
import type { CompanyDefaults } from "@/lib/types";
import type {
  PlannedSegment,
  ProductionScheduleResponse,
  ScheduleOperation,
} from "@/lib/production/types";

import { walkForwardClient } from "./schedule-shared";

export type ScheduleEditTarget =
  | { kind: "project"; rootMoUuid: string }
  | { kind: "mo"; moUuid: string }
  | { kind: "step"; stepUuid: string };

export interface ScheduleEditDialogProps {
  target: ScheduleEditTarget | null;
  data: ProductionScheduleResponse | null;
  workingIntervals: Array<{ open: Date; close: Date }>;
  parentByMo: Map<number, number | null>;
  company: CompanyDefaults;
  onClose: () => void;
}

interface MoBucket {
  moId: number;
  moUuid: string;
  moCode: string | null;
  itemName: string;
  ops: ScheduleOperation[];
}

interface ResolvedSegment {
  startMs: number;
  finishMs: number;
  kind: "work";
}

interface ResolvedPause {
  startMs: number;
  finishMs: number;
  kind: "pause";
}

type ResolvedRow = ResolvedSegment | ResolvedPause;

export function ScheduleEditDialog({
  target,
  data,
  workingIntervals,
  parentByMo,
  company,
  onClose,
}: ScheduleEditDialogProps) {
  const open = target !== null && data !== null;

  // Resolve the scope (which MOs + ops the dialog shows) from the
  // target + the workspace's parent-of-MO map. Done in a memo so we
  // recompute only when the target or schedule data changes.
  const scope = useMemo(() => {
    if (!open || !target || !data) return null;
    return resolveScope(target, data, parentByMo);
  }, [open, target, data, parentByMo]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{scope?.title ?? "Edit schedule"}</DialogTitle>
          <DialogDescription>{scope?.subtitle ?? null}</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 max-h-[60vh] space-y-4 overflow-y-auto px-1">
          {scope?.buckets.map((bucket) => (
            <MoBucketCard
              key={bucket.moId}
              bucket={bucket}
              workingIntervals={workingIntervals}
              company={company}
              showMoHeader={scope.kind !== "step"}
            />
          ))}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Read-only preview. Editing &amp; collab land next.
          </p>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoBucketCard({
  bucket,
  workingIntervals,
  company,
  showMoHeader,
}: {
  bucket: MoBucket;
  workingIntervals: Array<{ open: Date; close: Date }>;
  company: CompanyDefaults;
  showMoHeader: boolean;
}) {
  return (
    <section className="rounded-md border border-border/60 bg-card/40">
      {showMoHeader && (
        <header className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <div className="min-w-0">
            <Link
              href={`/production/manufacturing-orders/${bucket.moUuid}`}
              className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-brand hover:underline"
            >
              {bucket.moCode ?? `MO #${bucket.moId}`}
              <ExternalLink className="size-3" />
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {bucket.itemName}
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {bucket.ops.length} op{bucket.ops.length === 1 ? "" : "s"}
          </span>
        </header>
      )}
      <ul className="divide-y divide-border/60">
        {bucket.ops.map((op) => (
          <OperationRow
            key={op.id}
            op={op}
            workingIntervals={workingIntervals}
            company={company}
          />
        ))}
      </ul>
    </section>
  );
}

function OperationRow({
  op,
  workingIntervals,
  company,
}: {
  op: ScheduleOperation;
  workingIntervals: Array<{ open: Date; close: Date }>;
  company: CompanyDefaults;
}) {
  const rows = useMemo(
    () => resolveOpRows(op, workingIntervals),
    [op, workingIntervals],
  );

  const workSeconds = rows
    .filter((r): r is ResolvedSegment => r.kind === "work")
    .reduce((acc, r) => acc + (r.finishMs - r.startMs) / 1000, 0);

  return (
    <li className="px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {op.operation_description ?? `Op #${op.id}`}
          </p>
          {op.workstation_group && (
            <span
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground"
              title={op.workstation_group.name}
            >
              <span
                aria-hidden
                className="inline-block size-2 rounded-full"
                style={{
                  backgroundColor: op.workstation_group.color ?? "var(--brand)",
                }}
              />
              {op.workstation_group.name}
            </span>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          Work {formatDuration(workSeconds)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Not scheduled yet — drop the operation on the calendar first.
        </p>
      ) : (
        <ol className="space-y-1">
          {rows.map((row, i) => (
            <SegmentRow key={i} row={row} company={company} />
          ))}
        </ol>
      )}
    </li>
  );
}

function SegmentRow({
  row,
  company,
}: {
  row: ResolvedRow;
  company: CompanyDefaults;
}) {
  const isPause = row.kind === "pause";
  return (
    <li
      className={
        isPause
          ? "flex items-center gap-2 rounded border border-dashed border-amber-400/60 bg-amber-50/40 px-2 py-1 text-[11px] dark:bg-amber-950/20"
          : "flex items-center gap-2 rounded border border-border/60 bg-background px-2 py-1 text-[11px]"
      }
    >
      <span
        className={
          isPause
            ? "font-medium text-amber-700 dark:text-amber-300"
            : "font-medium text-foreground"
        }
      >
        {isPause ? "Pause" : "Work"}
      </span>
      <span className="font-mono text-foreground/80">
        {formatStamp(row.startMs, company)} → {formatStamp(row.finishMs, company)}
      </span>
      <span className="ml-auto text-muted-foreground">
        {formatDuration((row.finishMs - row.startMs) / 1000)}
      </span>
    </li>
  );
}

// ----- scope resolution ------------------------------------------

function resolveScope(
  target: ScheduleEditTarget,
  data: ProductionScheduleResponse,
  parentByMo: Map<number, number | null>,
): { title: string; subtitle: string | null; buckets: MoBucket[]; kind: ScheduleEditTarget["kind"] } | null {
  if (target.kind === "step") {
    const op = data.operations.find((o) => o.uuid === target.stepUuid);
    if (!op) return null;
    const bucket = bucketForMo(op.manufacturing_order_id, data);
    return {
      title: op.operation_description ?? `Operation #${op.id}`,
      subtitle: bucket
        ? `${bucket.moCode ?? `MO #${bucket.moId}`} · ${bucket.itemName}`
        : null,
      buckets: bucket ? [{ ...bucket, ops: [op] }] : [],
      kind: "step",
    };
  }

  if (target.kind === "mo") {
    const bucket = bucketForMoByUuid(target.moUuid, data);
    return {
      title: bucket?.moCode ?? "Manufacturing order",
      subtitle: bucket?.itemName ?? null,
      buckets: bucket ? [bucket] : [],
      kind: "mo",
    };
  }

  // project
  const rootBucket = bucketForMoByUuid(target.rootMoUuid, data);
  if (!rootBucket) {
    return { title: "Project", subtitle: null, buckets: [], kind: "project" };
  }

  const chainMoIds = collectChainMoIds(rootBucket.moId, data, parentByMo);
  const buckets = chainMoIds
    .map((id) => bucketForMo(id, data))
    .filter((b): b is MoBucket => b !== null);

  return {
    title: `Project · ${rootBucket.moCode ?? `MO #${rootBucket.moId}`}`,
    subtitle: `${buckets.length} MO${buckets.length === 1 ? "" : "s"} · ${rootBucket.itemName}`,
    buckets,
    kind: "project",
  };
}

function bucketForMo(
  moId: number,
  data: ProductionScheduleResponse,
): MoBucket | null {
  const ops = data.operations
    .filter((o) => o.manufacturing_order_id === moId)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
  const summary = ops.find((o) => o.manufacturing_order)?.manufacturing_order;
  if (!summary) return null;
  return {
    moId,
    moUuid: summary.uuid,
    moCode: summary.code,
    itemName: summary.item?.name ?? "(no item)",
    ops,
  };
}

function bucketForMoByUuid(
  uuid: string,
  data: ProductionScheduleResponse,
): MoBucket | null {
  const summary = data.operations.find(
    (o) => o.manufacturing_order?.uuid === uuid,
  )?.manufacturing_order;
  if (!summary) return null;
  return bucketForMo(summary.id, data);
}

/** Walk DOWN the chain from a root: every MO whose parent chain
 *  resolves to this root is included. Uses the workspace's
 *  parentByMo so only MOs visible in the schedule response count. */
function collectChainMoIds(
  rootId: number,
  data: ProductionScheduleResponse,
  parentByMo: Map<number, number | null>,
): number[] {
  const allMoIds = new Set<number>();
  for (const op of data.operations) {
    allMoIds.add(op.manufacturing_order_id);
  }
  const result: number[] = [];
  for (const id of allMoIds) {
    let cur: number | null = id;
    let seen = false;
    const guard = new Set<number>();
    while (cur != null) {
      if (guard.has(cur)) break;
      guard.add(cur);
      if (cur === rootId) {
        seen = true;
        break;
      }
      cur = parentByMo.get(cur) ?? null;
    }
    if (seen) result.push(id);
  }
  // Stable sort: root first, then by earliest planned_start.
  return result.sort((a, b) => {
    if (a === rootId) return -1;
    if (b === rootId) return 1;
    return earliestStartFor(a, data) - earliestStartFor(b, data);
  });
}

function earliestStartFor(
  moId: number,
  data: ProductionScheduleResponse,
): number {
  let min = Infinity;
  for (const op of data.operations) {
    if (op.manufacturing_order_id !== moId || !op.planned_start) continue;
    const t = new Date(op.planned_start).getTime();
    if (t < min) min = t;
  }
  return Number.isFinite(min) ? min : Number.MAX_SAFE_INTEGER;
}

// ----- per-op row derivation --------------------------------------

/** Produce work + pause rows for an op. Prefers stored
 *  `planned_segments` (manual pin) — falls back to walker output
 *  when none stored (auto-derived from working hours). */
function resolveOpRows(
  op: ScheduleOperation,
  workingIntervals: Array<{ open: Date; close: Date }>,
): ResolvedRow[] {
  const work: ResolvedSegment[] = sourceWorkSegments(op, workingIntervals);
  if (work.length === 0) return [];

  const rows: ResolvedRow[] = [];
  for (let i = 0; i < work.length; i++) {
    rows.push(work[i]);
    const next = work[i + 1];
    if (next && next.startMs > work[i].finishMs) {
      rows.push({
        kind: "pause",
        startMs: work[i].finishMs,
        finishMs: next.startMs,
      });
    }
  }
  return rows;
}

function sourceWorkSegments(
  op: ScheduleOperation,
  workingIntervals: Array<{ open: Date; close: Date }>,
): ResolvedSegment[] {
  if (op.planned_segments && op.planned_segments.length > 0) {
    return op.planned_segments.map((seg: PlannedSegment) => ({
      kind: "work" as const,
      startMs: new Date(seg.start_at).getTime(),
      finishMs: new Date(seg.finish_at).getTime(),
    }));
  }
  if (!op.planned_start || op.planned_duration_seconds <= 0) return [];
  const cursor = new Date(op.planned_start).getTime();
  const walked = walkForwardClient(
    workingIntervals,
    cursor,
    op.planned_duration_seconds,
  );
  return walked.segments.map((s) => ({
    kind: "work" as const,
    startMs: s.open,
    finishMs: s.close,
  }));
}

// ----- formatting helpers -----------------------------------------

function formatStamp(ms: number, company: CompanyDefaults): string {
  const d = new Date(ms);
  const date = formatCompanyDate(d.toISOString(), company);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${date} ${hh}:${mm}`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

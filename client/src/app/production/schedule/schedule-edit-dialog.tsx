"use client";

/**
 * Click-to-edit dialog for calendar blocks. Three variants:
 *
 *   project — chain root. Edits every MO in the chain + every op.
 *   mo      — single MO. Edits every op inside it.
 *   step    — single operation.
 *
 * Each op is split into editable WORK rows; PAUSE rows are the gaps
 * between consecutive work rows and render as their own (read-only,
 * recomputed) row so the planner sees the actual pause spans.
 *
 * Save persists each modified op's segments via the
 * `/steps/:id/set-segments` endpoint — the walker is NOT consulted,
 * the literal times become the source of truth.
 *
 * Realtime collab is mandatory per CLAUDE.md hard rule: per-form
 * Phoenix channel, presence avatars, per-row peer indicators, head-
 * of-room save gate, live cursors. Topic depends on the target:
 *   project → form:project:<root_mo_uuid>
 *   mo      → form:manufacturing-order:<mo_uuid>
 *   step    → form:manufacturing-order-step:<step_uuid>
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, LockKeyhole, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm, type JoinError } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { invalidateAudit } from "@/lib/audit/invalidator";
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
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type SegmentRow = { start_at: string; finish_at: string };
type DialogState = { ops: Record<string, SegmentRow[]> };

interface MoBucket {
  moId: number;
  moUuid: string;
  moCode: string | null;
  itemName: string;
  ops: ScheduleOperation[];
}

interface ResolvedScope {
  title: string;
  subtitle: string | null;
  buckets: MoBucket[];
  kind: ScheduleEditTarget["kind"];
  resource: string;
}

export function ScheduleEditDialog(props: ScheduleEditDialogProps) {
  const open = props.target !== null && props.data !== null;
  // Keep the inner component mounted ONLY while open so we don't hold
  // a channel subscription for a closed dialog. Each open is a fresh
  // join — initial state is recomputed from current schedule data so
  // peers opening at different times don't get stale snapshots.
  return (
    <Dialog open={open} onOpenChange={(v) => !v && props.onClose()}>
      {open && <ScheduleEditDialogInner {...props} />}
    </Dialog>
  );
}

function ScheduleEditDialogInner({
  target,
  data,
  workingIntervals,
  parentByMo,
  company,
  canEdit,
  onClose,
  onSaved,
}: ScheduleEditDialogProps) {
  // target+data are non-null here because Inner only mounts when open.
  const scope = useMemo<ResolvedScope | null>(
    () => (target && data ? resolveScope(target, data, parentByMo) : null),
    [target, data, parentByMo],
  );

  const initialState = useMemo<DialogState>(() => {
    if (!scope) return { ops: {} };
    const out: Record<string, SegmentRow[]> = {};
    for (const bucket of scope.buckets) {
      for (const op of bucket.ops) {
        out[op.uuid] = deriveInitialSegments(op, workingIntervals);
      }
    }
    return { ops: out };
  }, [scope, workingIntervals]);

  const {
    state,
    setField,
    presence,
    fieldEditors,
    focusField,
    blurField,
    connected,
    joinError,
    creator,
    isCreator,
    cursors,
    setCursor,
    hideCursor,
    broadcastCommit,
  } = useLiveForm<DialogState>({
    resource: scope?.resource ?? "",
    initialState,
    disabled: !scope || !canEdit,
    onCommit: (payload) => {
      const p = payload as { kind?: string } | null;
      if (p?.kind === "saved") {
        toast.success(`${creator?.name ?? "A teammate"} saved the schedule.`);
        onSaved();
        onClose();
      }
    },
  });

  useFormPresenceBeacon(scope?.resource ?? "");

  // ----- cursor anchor wiring -----
  const cursorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorSize, setAnchorSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = cursorAnchorRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setAnchorSize({ w: rect.width, h: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => hideCursor(), [hideCursor]);
  const onCursorMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = cursorAnchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setCursor((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
    },
    [setCursor],
  );

  // ----- save handling -----
  const [saving, setSaving] = useState(false);
  const dirty = useMemo(
    () => opsDirty(initialState.ops, state.ops),
    [initialState.ops, state.ops],
  );

  async function handleSave() {
    if (!scope || !isCreator || !dirty) return;
    const changed = changedOpUuids(initialState.ops, state.ops);
    const opByUuid = new Map<string, ScheduleOperation>();
    for (const bucket of scope.buckets) {
      for (const op of bucket.ops) opByUuid.set(op.uuid, op);
    }

    setSaving(true);
    try {
      for (const opUuid of changed) {
        const op = opByUuid.get(opUuid);
        if (!op) continue;
        const moSummary = op.manufacturing_order;
        if (!moSummary) continue;
        const segments = state.ops[opUuid] ?? [];
        const body = {
          segments: segments.map((s) => ({
            start_at: localToIso(s.start_at),
            finish_at: localToIso(s.finish_at),
          })),
        };
        const res = await fetch(
          `/api/production/manufacturing-orders/${moSummary.uuid}/steps/${op.uuid}/set-segments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            cache: "no-store",
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            err.detail || `Failed to save ${op.operation_description ?? "operation"}`,
          );
        }
        invalidateAudit("manufacturing_order_step", op.id);
      }
      broadcastCommit({ kind: "saved", state });
      toast.success("Schedule saved.");
      onSaved();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  // ----- mutators -----
  function setOpSegments(opUuid: string, next: SegmentRow[]) {
    setField("ops", { ...state.ops, [opUuid]: next });
  }

  return (
    <DialogContent
      ref={cursorAnchorRef}
      onMouseMove={onCursorMove}
      onMouseLeave={hideCursor}
      className="max-h-[88vh] max-w-3xl overflow-hidden"
    >
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-lg">
        {Object.entries(cursors).map(([id, cursor]) => (
          <RemoteCursor
            key={id}
            cursor={cursor}
            anchorWidth={anchorSize.w}
            anchorHeight={anchorSize.h}
          />
        ))}
      </div>

      <DialogHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <DialogTitle>{scope?.title ?? "Edit schedule"}</DialogTitle>
            <DialogDescription>{scope?.subtitle ?? null}</DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            <CollabAvatars peers={presence} />
            {!canEdit && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                <LockKeyhole className="size-3" />
                Read-only
              </span>
            )}
          </div>
        </div>
      </DialogHeader>

      {joinError && <JoinErrorBlock error={joinError} />}

      {!joinError && !isCreator && creator && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
          <strong className="font-semibold">{creator.name}</strong> is the host
          of this edit room. Only they can save.
        </div>
      )}

      {!joinError && (
        <div className="-mx-1 max-h-[58vh] space-y-4 overflow-y-auto px-1">
          {scope?.buckets.map((bucket) => (
            <MoBucketCard
              key={bucket.moId}
              bucket={bucket}
              segmentsByOp={state.ops}
              fieldEditors={fieldEditors}
              onChange={setOpSegments}
              onFocusField={focusField}
              onBlurField={blurField}
              disabled={!canEdit || !isCreator || saving}
              company={company}
              showMoHeader={scope.kind !== "step"}
            />
          ))}
        </div>
      )}

      <DialogFooter className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          {connected
            ? dirty
              ? "Unsaved changes."
              : "Up to date."
            : "Connecting…"}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!isCreator || !dirty || saving || !!joinError}
            title={
              !isCreator && creator
                ? `Only ${creator.name} can save this room.`
                : undefined
            }
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

// ===== Per-MO + per-op rendering =====

function MoBucketCard({
  bucket,
  segmentsByOp,
  fieldEditors,
  onChange,
  onFocusField,
  onBlurField,
  disabled,
  company,
  showMoHeader,
}: {
  bucket: MoBucket;
  segmentsByOp: Record<string, SegmentRow[]>;
  fieldEditors: Record<string, ReturnType<typeof useLiveForm>["fieldEditors"][string]>;
  onChange: (opUuid: string, next: SegmentRow[]) => void;
  onFocusField: (field: string) => void;
  onBlurField: (field: string) => void;
  disabled: boolean;
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
          <OperationEditor
            key={op.id}
            op={op}
            segments={segmentsByOp[op.uuid] ?? []}
            fieldEditors={fieldEditors}
            onChange={(next) => onChange(op.uuid, next)}
            onFocusField={onFocusField}
            onBlurField={onBlurField}
            disabled={disabled}
            company={company}
          />
        ))}
      </ul>
    </section>
  );
}

function OperationEditor({
  op,
  segments,
  fieldEditors,
  onChange,
  onFocusField,
  onBlurField,
  disabled,
  company,
}: {
  op: ScheduleOperation;
  segments: SegmentRow[];
  fieldEditors: Record<string, ReturnType<typeof useLiveForm>["fieldEditors"][string]>;
  onChange: (next: SegmentRow[]) => void;
  onFocusField: (field: string) => void;
  onBlurField: (field: string) => void;
  disabled: boolean;
  company: CompanyDefaults;
}) {
  const workSeconds = segments.reduce((acc, seg) => {
    const s = new Date(seg.start_at).getTime();
    const f = new Date(seg.finish_at).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(f) || f <= s) return acc;
    return acc + (f - s) / 1000;
  }, 0);

  function updateRow(i: number, patch: Partial<SegmentRow>) {
    const next = segments.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange(next);
  }

  function appendWork() {
    const last = segments[segments.length - 1];
    const baseStart = last ? new Date(last.finish_at) : new Date();
    const start = roundToMinute(baseStart);
    const finish = new Date(start.getTime() + 30 * 60 * 1000);
    onChange([
      ...segments,
      { start_at: dateToLocal(start), finish_at: dateToLocal(finish) },
    ]);
  }

  function insertPauseAfter(i: number) {
    // Move row i+1's start LATER by 30m to create a gap. If no
    // row i+1, append a new work row 30m + 30m away.
    const next = [...segments];
    const after = next[i + 1];
    if (after) {
      const newStart = new Date(new Date(after.start_at).getTime() + 30 * 60 * 1000);
      const newFinish = new Date(new Date(after.finish_at).getTime() + 30 * 60 * 1000);
      next[i + 1] = {
        start_at: dateToLocal(newStart),
        finish_at: dateToLocal(newFinish),
      };
      // Cascade the shift forward through every subsequent row so
      // we don't accidentally introduce an overlap downstream.
      for (let j = i + 2; j < next.length; j++) {
        next[j] = {
          start_at: dateToLocal(new Date(new Date(next[j].start_at).getTime() + 30 * 60 * 1000)),
          finish_at: dateToLocal(new Date(new Date(next[j].finish_at).getTime() + 30 * 60 * 1000)),
        };
      }
      onChange(next);
    } else {
      const curEnd = new Date(segments[i].finish_at);
      const start = new Date(curEnd.getTime() + 30 * 60 * 1000);
      const finish = new Date(start.getTime() + 30 * 60 * 1000);
      onChange([
        ...segments,
        { start_at: dateToLocal(start), finish_at: dateToLocal(finish) },
      ]);
    }
  }

  function removeRow(i: number) {
    onChange(segments.filter((_, idx) => idx !== i));
  }

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

      {segments.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Not scheduled yet — drop the operation on the calendar first.
        </p>
      ) : (
        <ol className="space-y-1">
          {segments.map((seg, i) => {
            const prev = segments[i - 1];
            const pauseSeconds = prev
              ? Math.max(
                  0,
                  (new Date(seg.start_at).getTime() -
                    new Date(prev.finish_at).getTime()) /
                    1000,
                )
              : 0;
            return (
              <Fragment key={i}>
                {pauseSeconds > 0 && (
                  <li className="flex items-center gap-2 rounded border border-dashed border-amber-400/60 bg-amber-50/40 px-2 py-1 text-[11px] dark:bg-amber-950/20">
                    <span className="font-medium text-amber-700 dark:text-amber-300">
                      Pause
                    </span>
                    <span className="font-mono text-foreground/80">
                      {formatStampLocal(prev!.finish_at, company)} →{" "}
                      {formatStampLocal(seg.start_at, company)}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {formatDuration(pauseSeconds)}
                    </span>
                  </li>
                )}
                <SegmentEditRow
                  opUuid={op.uuid}
                  index={i}
                  seg={seg}
                  fieldKey={`op:${op.uuid}:row:${i}`}
                  peer={fieldEditors[`op:${op.uuid}:row:${i}`] ?? null}
                  onChange={(patch) => updateRow(i, patch)}
                  onFocusField={onFocusField}
                  onBlurField={onBlurField}
                  onInsertPauseAfter={() => insertPauseAfter(i)}
                  onRemove={() => removeRow(i)}
                  disabled={disabled}
                  canRemove={segments.length > 1}
                />
              </Fragment>
            );
          })}
        </ol>
      )}

      {segments.length > 0 && (
        <button
          type="button"
          onClick={appendWork}
          disabled={disabled}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-brand hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
        >
          <Plus className="size-3" /> Add work segment
        </button>
      )}
    </li>
  );
}

function SegmentEditRow({
  seg,
  fieldKey,
  peer,
  onChange,
  onFocusField,
  onBlurField,
  onInsertPauseAfter,
  onRemove,
  disabled,
  canRemove,
}: {
  opUuid: string;
  index: number;
  seg: SegmentRow;
  fieldKey: string;
  peer: ReturnType<typeof useLiveForm>["fieldEditors"][string];
  onChange: (patch: Partial<SegmentRow>) => void;
  onFocusField: (field: string) => void;
  onBlurField: (field: string) => void;
  onInsertPauseAfter: () => void;
  onRemove: () => void;
  disabled: boolean;
  canRemove: boolean;
}) {
  const startMs = new Date(seg.start_at).getTime();
  const finishMs = new Date(seg.finish_at).getTime();
  const invalid =
    !Number.isFinite(startMs) || !Number.isFinite(finishMs) || finishMs <= startMs;

  return (
    <li
      className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 text-[11px] ${
        invalid
          ? "border-destructive bg-destructive/5"
          : "border-border/60 bg-background"
      }`}
    >
      <span className="font-medium text-foreground">Work</span>
      <Input
        type="datetime-local"
        value={seg.start_at}
        onChange={(e) => onChange({ start_at: e.target.value })}
        onFocus={() => onFocusField(fieldKey)}
        onBlur={() => onBlurField(fieldKey)}
        disabled={disabled}
        className="h-7 w-[180px] text-[11px]"
      />
      <span aria-hidden>→</span>
      <Input
        type="datetime-local"
        value={seg.finish_at}
        onChange={(e) => onChange({ finish_at: e.target.value })}
        onFocus={() => onFocusField(fieldKey)}
        onBlur={() => onBlurField(fieldKey)}
        disabled={disabled}
        className="h-7 w-[180px] text-[11px]"
      />
      <FieldEditingIndicator peer={peer} />
      <span className="ml-auto inline-flex items-center gap-1">
        <button
          type="button"
          onClick={onInsertPauseAfter}
          disabled={disabled}
          title="Insert a pause after this segment"
          className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          + Pause
        </button>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            title="Remove this segment"
            className="rounded p-1 text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </span>
    </li>
  );
}

function JoinErrorBlock({ error }: { error: JoinError }) {
  const msg =
    error.reason === "forbidden"
      ? "You don't have permission to edit this room."
      : error.reason === "form_full"
        ? `This room is full (max ${error.limit ?? 10} editors).`
        : "Couldn't join the edit room.";
  return (
    <div className="rounded-md border border-destructive/60 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      {msg}
    </div>
  );
}

// ===== Scope resolution =====

function resolveScope(
  target: ScheduleEditTarget,
  data: ProductionScheduleResponse,
  parentByMo: Map<number, number | null>,
): ResolvedScope | null {
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
      resource: `manufacturing-order-step:${op.uuid}`,
    };
  }

  if (target.kind === "mo") {
    const bucket = bucketForMoByUuid(target.moUuid, data);
    return {
      title: bucket?.moCode ?? "Manufacturing order",
      subtitle: bucket?.itemName ?? null,
      buckets: bucket ? [bucket] : [],
      kind: "mo",
      resource: `manufacturing-order:${target.moUuid}`,
    };
  }

  const rootBucket = bucketForMoByUuid(target.rootMoUuid, data);
  if (!rootBucket) {
    return {
      title: "Project",
      subtitle: null,
      buckets: [],
      kind: "project",
      resource: `project:${target.rootMoUuid}`,
    };
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
    resource: `project:${target.rootMoUuid}`,
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

function collectChainMoIds(
  rootId: number,
  data: ProductionScheduleResponse,
  parentByMo: Map<number, number | null>,
): number[] {
  const allMoIds = new Set<number>();
  for (const op of data.operations) allMoIds.add(op.manufacturing_order_id);
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
  return result.sort((a, b) => {
    if (a === rootId) return -1;
    if (b === rootId) return 1;
    return earliestStartFor(a, data) - earliestStartFor(b, data);
  });
}

function earliestStartFor(moId: number, data: ProductionScheduleResponse): number {
  let min = Infinity;
  for (const op of data.operations) {
    if (op.manufacturing_order_id !== moId || !op.planned_start) continue;
    const t = new Date(op.planned_start).getTime();
    if (t < min) min = t;
  }
  return Number.isFinite(min) ? min : Number.MAX_SAFE_INTEGER;
}

// ===== Segment derivation =====

function deriveInitialSegments(
  op: ScheduleOperation,
  workingIntervals: Array<{ open: Date; close: Date }>,
): SegmentRow[] {
  if (op.planned_segments && op.planned_segments.length > 0) {
    return op.planned_segments.map((s: PlannedSegment) => ({
      start_at: dateToLocal(new Date(s.start_at)),
      finish_at: dateToLocal(new Date(s.finish_at)),
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
    start_at: dateToLocal(new Date(s.open)),
    finish_at: dateToLocal(new Date(s.close)),
  }));
}

function opsDirty(
  initial: Record<string, SegmentRow[]>,
  current: Record<string, SegmentRow[]>,
): boolean {
  const keys = new Set([...Object.keys(initial), ...Object.keys(current)]);
  for (const k of keys) {
    const a = initial[k] ?? [];
    const b = current[k] ?? [];
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) {
      if (a[i].start_at !== b[i].start_at || a[i].finish_at !== b[i].finish_at)
        return true;
    }
  }
  return false;
}

function changedOpUuids(
  initial: Record<string, SegmentRow[]>,
  current: Record<string, SegmentRow[]>,
): string[] {
  const out: string[] = [];
  const keys = new Set([...Object.keys(initial), ...Object.keys(current)]);
  for (const k of keys) {
    const a = initial[k] ?? [];
    const b = current[k] ?? [];
    if (a.length !== b.length) {
      out.push(k);
      continue;
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i].start_at !== b[i].start_at || a[i].finish_at !== b[i].finish_at) {
        out.push(k);
        break;
      }
    }
  }
  return out;
}

// ===== datetime-local helpers =====

/** Format a Date as the YYYY-MM-DDTHH:MM that <input type="datetime-local">
 *  expects. Local timezone — input renders local. */
function dateToLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

/** Convert a datetime-local string ("YYYY-MM-DDTHH:MM" interpreted as
 *  LOCAL time) back to an ISO8601 UTC string for the BE. */
function localToIso(local: string): string {
  const d = new Date(local);
  return d.toISOString();
}

function roundToMinute(d: Date): Date {
  const next = new Date(d);
  next.setSeconds(0, 0);
  return next;
}

function formatStampLocal(local: string, company: CompanyDefaults): string {
  const d = new Date(local);
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

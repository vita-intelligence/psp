"use client";

import { useMemo, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GripVertical,
  Inbox,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatCompanyDate } from "@/lib/format/company";
import type { CompanyDefaults } from "@/lib/types";
import type { BacklogMO } from "@/lib/production/types";

interface Props {
  items: BacklogMO[];
  canEdit: boolean;
  company: CompanyDefaults;
}

interface TreeNode {
  mo: BacklogMO;
  children: TreeNode[];
}

/** Build a project tree from the flat backlog list. Parents whose
 *  parent_mo_id points outside the backlog (already scheduled or
 *  unrelated) act as roots-of-what-we-can-see. */
function buildTree(items: BacklogMO[]): TreeNode[] {
  const byId = new Map<number, TreeNode>();
  for (const mo of items) byId.set(mo.id, { mo, children: [] });

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.mo.parent_mo_id;
    if (parentId != null && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Stable sort: due_date asc (nulls last), then code.
  const cmp = (a: TreeNode, b: TreeNode) => {
    const da = a.mo.due_date ? new Date(a.mo.due_date).getTime() : Infinity;
    const db = b.mo.due_date ? new Date(b.mo.due_date).getTime() : Infinity;
    if (da !== db) return da - db;
    return (a.mo.code ?? "").localeCompare(b.mo.code ?? "");
  };
  const sortRecursive = (nodes: TreeNode[]) => {
    nodes.sort(cmp);
    for (const n of nodes) sortRecursive(n.children);
  };
  sortRecursive(roots);
  return roots;
}

export function ScheduleBacklog({ items, canEdit, company }: Props) {
  // The rail itself is a drop target — dropping a scheduled block on
  // it = unschedule. The workspace inspects over.id === "backlog-zone".
  const { setNodeRef, isOver } = useDroppable({ id: "backlog-zone" });

  const tree = useMemo(() => buildTree(items), [items]);

  return (
    <aside
      ref={setNodeRef}
      className={cn(
        "flex w-80 shrink-0 flex-col border-r border-border/60 bg-muted/30 transition-colors",
        isOver && "bg-brand/10 ring-2 ring-inset ring-brand/40",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-card px-3 py-2">
        <Inbox className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">Backlog</p>
          <p className="truncate text-[10px] text-muted-foreground">
            Approved · awaiting schedule
          </p>
        </div>
        <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
          {items.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div
            className={cn(
              "rounded-md border border-dashed border-border/60 bg-card/50 px-3 py-6 text-center text-[11px] text-muted-foreground",
              isOver && "border-brand bg-brand/10 text-brand",
            )}
          >
            {isOver
              ? "Drop to send back to the backlog."
              : "Nothing to schedule. Approved MOs appear here ready to drag onto the calendar."}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {tree.map((node) => (
              <TreeRow
                key={node.mo.id}
                node={node}
                canEdit={canEdit}
                company={company}
                depth={0}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function TreeRow({
  node,
  canEdit,
  company,
  depth,
}: {
  node: TreeNode;
  canEdit: boolean;
  company: CompanyDefaults;
  depth: number;
}) {
  // Collapsed by default so the rail stays compact — planner
  // expands only the projects they want to break apart.
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.children.length > 0;
  const hasSteps = node.mo.steps_summary.length > 0;
  const isProjectRoot = depth === 0 && hasChildren;

  return (
    <li>
      <BacklogMOCard
        mo={node.mo}
        canEdit={canEdit}
        company={company}
        depth={depth}
        // Project drag id when this row has descendants; otherwise
        // it's a plain MO drag. The workspace routes accordingly.
        dragKind={isProjectRoot ? "project" : "mo"}
        expanded={expanded}
        canToggle={hasChildren || hasSteps}
        onToggle={() => setExpanded((e) => !e)}
      />

      {expanded && (hasChildren || hasSteps) && (
        <ul
          className="mt-1 space-y-1"
          style={{ marginLeft: 16 + depth * 12 }}
        >
          {hasChildren &&
            node.children.map((child) => (
              <TreeRow
                key={child.mo.id}
                node={child}
                canEdit={canEdit}
                company={company}
                depth={depth + 1}
              />
            ))}
          {hasSteps && !hasChildren && (
            <ul className="space-y-0.5">
              {node.mo.steps_summary.map((s) => (
                <BacklogOpRow
                  key={s.id}
                  moUuid={node.mo.uuid}
                  moDuration={node.mo.planned_duration_seconds}
                  step={s}
                  canEdit={canEdit}
                />
              ))}
            </ul>
          )}
        </ul>
      )}
    </li>
  );
}

function BacklogMOCard({
  mo,
  canEdit,
  company,
  depth,
  dragKind,
  expanded,
  canToggle,
  onToggle,
}: {
  mo: BacklogMO;
  canEdit: boolean;
  company: CompanyDefaults;
  depth: number;
  dragKind: "project" | "mo";
  expanded: boolean;
  canToggle: boolean;
  onToggle: () => void;
}) {
  const id = `backlog-${dragKind}-${mo.uuid}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    disabled: !canEdit,
    data: {
      kind: dragKind,
      uuid: mo.uuid,
      durationSeconds: mo.planned_duration_seconds,
    },
  });

  const dueLabel = mo.due_date
    ? formatCompanyDate(mo.due_date, company)
    : null;
  const overdue = mo.due_date && new Date(mo.due_date).getTime() < Date.now();

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "group relative flex select-none items-start gap-1.5 rounded-md border border-border/60 bg-card px-2 py-2 shadow-sm transition-shadow",
        canEdit ? "cursor-grab" : "cursor-default",
        isDragging && "z-50 cursor-grabbing opacity-60 shadow-lg",
        dragKind === "project" && "border-indigo-300 bg-indigo-50/40",
      )}
    >
      {canToggle ? (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </button>
      ) : (
        canEdit && (
          <GripVertical className="mt-0.5 size-3 shrink-0 text-muted-foreground/60" />
        )
      )}

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-1">
          <Link
            href={`/production/manufacturing-orders/${mo.uuid}`}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              "truncate font-mono text-[10px] font-semibold hover:underline",
              dragKind === "project"
                ? "text-indigo-700 dark:text-indigo-300"
                : "text-brand",
            )}
            title={mo.code ?? `MO #${mo.id}`}
          >
            {dragKind === "project" && (
              <GitBranch className="mr-0.5 inline size-2.5 align-text-bottom" />
            )}
            {mo.code ?? `MO #${mo.id}`}
          </Link>
          {dragKind === "project" && (
            <span className="shrink-0 rounded-full bg-indigo-100 px-1 py-0.5 text-[9px] uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
              Project
            </span>
          )}
          {dragKind === "mo" && depth > 0 && (
            <span className="shrink-0 rounded-full bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
              Sub-MO
            </span>
          )}
        </div>
        <p className="truncate text-[11px]" title={mo.item?.name ?? ""}>
          {mo.item?.name ?? "—"}
        </p>
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="truncate font-mono tabular-nums">
            {mo.quantity}
          </span>
          <div className="flex items-center gap-2">
            {mo.step_count > 0 && (
              <span className="tabular-nums">
                {mo.step_count} ops · {formatDurationShort(mo.planned_duration_seconds)}
              </span>
            )}
            {dueLabel && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5",
                  overdue && "text-destructive",
                )}
              >
                <CalendarClock className="size-2.5" />
                {dueLabel}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Draggable op row inside an expanded backlog MO. Drags as
 *  `backlog-mo-<uuid>` so it routes through the same schedule-mo
 *  handler — dropping on a workstation row will pin the first step
 *  to that station (the dragged op itself for single-op MOs). */
function BacklogOpRow({
  moUuid,
  moDuration,
  step,
  canEdit,
}: {
  moUuid: string;
  moDuration: number;
  step: import("@/lib/production/types").BacklogMOStep;
  canEdit: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `backlog-op-${moUuid}`,
    disabled: !canEdit,
    data: {
      kind: "mo",
      uuid: moUuid,
      durationSeconds: moDuration,
      anchorStepUuid: step.uuid,
    },
  });

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "flex select-none items-center gap-1.5 rounded px-1.5 py-1 text-[10px] text-muted-foreground",
        canEdit
          ? "cursor-grab hover:bg-muted/60"
          : "cursor-default",
        isDragging && "z-50 cursor-grabbing opacity-60 bg-muted/80",
      )}
      title={
        canEdit
          ? "Drag onto a station to schedule this MO with this op pinned there."
          : "Operation step (read-only)."
      }
    >
      <span className="inline-flex size-3.5 items-center justify-center rounded bg-muted text-[9px] font-mono">
        {step.sort_order + 1}
      </span>
      {step.workstation_group?.color && (
        <span
          className="inline-block size-1.5 rounded-sm"
          style={{ backgroundColor: step.workstation_group.color }}
        />
      )}
      <span className="truncate">
        {step.workstation_group?.name ?? "—"}
      </span>
      <span className="ml-auto shrink-0 tabular-nums">
        {formatDurationShort(step.planned_duration_seconds)}
      </span>
    </li>
  );
}

function formatDurationShort(seconds: number): string {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

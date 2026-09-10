"use client";

import { useMemo, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  CalendarCheck,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Crosshair,
  GitBranch,
  GripVertical,
  Inbox,
  Search,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatCompanyDate } from "@/lib/format/company";
import type { CompanyDefaults } from "@/lib/types";
import type {
  BacklogMO,
  ScheduledSummaryRow,
} from "@/lib/production/types";

interface Props {
  items: BacklogMO[];
  /** Range-agnostic list from the BE — every non-terminal MO at this
   *  site with at least one scheduled step, whether or not that step
   *  falls inside the currently visible calendar window. */
  scheduledItems: ScheduledSummaryRow[];
  focusMoUuid: string | null;
  onFocusMo: (uuid: string) => void;
  canEdit: boolean;
  company: CompanyDefaults;
  onQuickSchedule?: (mo: BacklogMO, isProject: boolean) => void;
}

type BacklogTab = "backlog" | "scheduled";

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

export function ScheduleBacklog({
  items,
  scheduledItems,
  focusMoUuid,
  onFocusMo,
  canEdit,
  company,
  onQuickSchedule,
}: Props) {
  // The rail itself is a drop target — dropping a scheduled block on
  // it = unschedule. The workspace inspects over.id === "backlog-zone".
  const { setNodeRef, isOver } = useDroppable({ id: "backlog-zone" });

  const [tab, setTab] = useState<BacklogTab>("backlog");
  const [query, setQuery] = useState("");

  const tree = useMemo(() => buildTree(items), [items]);

  // "On calendar" list: MOs currently placed on the calendar and not
  // yet finished. Sorted by earliest scheduled start so the planner
  // can scan "what's imminent" at the top. Filtered by the same query
  // as the backlog for a consistent search experience.
  const scheduledSorted = useMemo(() => {
    const rows = [...scheduledItems];
    rows.sort((a, b) => {
      const ta = a.first_start ? new Date(a.first_start).getTime() : Infinity;
      const tb = b.first_start ? new Date(b.first_start).getTime() : Infinity;
      return ta - tb;
    });
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const code = (r.code ?? "").toLowerCase();
      const name = (r.item_name ?? "").toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [scheduledItems, query]);

  return (
    <aside
      ref={setNodeRef}
      className={cn(
        "flex w-80 shrink-0 flex-col border-r border-border/60 bg-muted/30 transition-colors",
        isOver && "bg-brand/10 ring-2 ring-inset ring-brand/40",
      )}
    >
      {/* Segmented tabs — Backlog (unscheduled + draggable) vs On
          calendar (already-placed + clickable to jump). Planner
          toggles based on what they're trying to do: place new work
          vs find/adjust work that's already scheduled. */}
      <div className="grid grid-cols-2 gap-0 border-b border-border/60 bg-card">
        <button
          type="button"
          onClick={() => setTab("backlog")}
          className={cn(
            "flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-semibold transition-colors",
            tab === "backlog"
              ? "border-b-2 border-brand text-brand"
              : "border-b-2 border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Inbox className="size-3.5" />
          <span>Backlog</span>
          <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-foreground">
            {items.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab("scheduled")}
          className={cn(
            "flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-semibold transition-colors",
            tab === "scheduled"
              ? "border-b-2 border-brand text-brand"
              : "border-b-2 border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <CalendarCheck className="size-3.5" />
          <span>On calendar</span>
          <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-foreground">
            {scheduledItems.length}
          </span>
        </button>
      </div>

      <div className="border-b border-border/60 bg-card/60 px-2 py-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === "backlog"
                ? "Search backlog by code / product…"
                : "Search scheduled MOs by code / product…"
            }
            className="w-full rounded border border-border/60 bg-background py-1 pl-6 pr-2 text-[11px] outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tab === "backlog"
          ? renderBacklog({
              items,
              tree,
              isOver,
              canEdit,
              company,
              onQuickSchedule,
              query,
            })
          : renderScheduled({
              rows: scheduledSorted,
              totalCount: scheduledItems.length,
              focusMoUuid,
              onFocusMo,
              company,
            })}
      </div>
    </aside>
  );
}

function renderBacklog({
  items,
  tree,
  isOver,
  canEdit,
  company,
  onQuickSchedule,
  query,
}: {
  items: BacklogMO[];
  tree: TreeNode[];
  isOver: boolean;
  canEdit: boolean;
  company: CompanyDefaults;
  onQuickSchedule?: (mo: BacklogMO, isProject: boolean) => void;
  query: string;
}) {
  if (items.length === 0) {
    return (
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
    );
  }

  const q = query.trim().toLowerCase();
  const filteredTree = q ? filterTreeByQuery(tree, q) : tree;

  if (filteredTree.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-card/50 px-3 py-6 text-center text-[11px] text-muted-foreground">
        No backlog rows match &ldquo;{query}&rdquo;.
      </div>
    );
  }

  return (
    <ul className="space-y-1.5">
      {filteredTree.map((node) => (
        <TreeRow
          key={node.mo.id}
          node={node}
          canEdit={canEdit}
          company={company}
          depth={0}
          onQuickSchedule={onQuickSchedule}
        />
      ))}
    </ul>
  );
}

function renderScheduled({
  rows,
  totalCount,
  focusMoUuid,
  onFocusMo,
  company,
}: {
  rows: ScheduledSummaryRow[];
  totalCount: number;
  focusMoUuid: string | null;
  onFocusMo: (uuid: string) => void;
  company: CompanyDefaults;
}) {
  if (totalCount === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-card/50 px-3 py-6 text-center text-[11px] text-muted-foreground">
        Nothing on the calendar for this site yet. Drag a backlog row
        onto the timeline to schedule one.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 bg-card/50 px-3 py-6 text-center text-[11px] text-muted-foreground">
        No scheduled MO matches your search.
      </div>
    );
  }

  return (
    <ul className="space-y-1">
      {rows.map((row) => (
        <ScheduledMORow
          key={row.id}
          row={row}
          focused={focusMoUuid === row.uuid}
          onFocus={() => onFocusMo(row.uuid)}
          company={company}
        />
      ))}
    </ul>
  );
}

/** Filter the pre-built backlog tree by a case-insensitive query
 *  against MO code + item name. Keeps parents whose children match
 *  even when the parent itself doesn't. */
function filterTreeByQuery(nodes: TreeNode[], q: string): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    const code = (node.mo.code ?? "").toLowerCase();
    const name = (node.mo.item?.name ?? "").toLowerCase();
    const selfMatch = code.includes(q) || name.includes(q);
    const filteredChildren = filterTreeByQuery(node.children, q);
    if (selfMatch || filteredChildren.length > 0) {
      out.push({ mo: node.mo, children: filteredChildren });
    }
  }
  return out;
}

function ScheduledMORow({
  row,
  focused,
  onFocus,
  company,
}: {
  row: ScheduledSummaryRow;
  focused: boolean;
  onFocus: () => void;
  company: CompanyDefaults;
}) {
  const startLabel = row.first_start
    ? formatCompanyDate(row.first_start, company)
    : "—";
  const statusChip = STATUS_CHIP[row.status] ?? {
    label: row.status,
    className: "bg-muted text-muted-foreground",
  };
  const itemName = row.item_name ?? "—";
  return (
    <li>
      <button
        type="button"
        onClick={onFocus}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
          focused
            ? "border-brand bg-brand/10"
            : "border-border/60 bg-card hover:border-brand/40 hover:bg-brand/[0.04]",
        )}
        title="Jump the calendar to this MO's first operation"
      >
        <Crosshair
          className={cn(
            "size-3 shrink-0",
            focused ? "text-brand" : "text-muted-foreground",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-[10px] font-semibold">
              {row.code ?? `MO #${row.id}`}
            </span>
            <span
              className={cn(
                "rounded-sm px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide",
                statusChip.className,
              )}
            >
              {statusChip.label}
            </span>
          </div>
          <p className="truncate text-[11px]" title={itemName}>
            {itemName}
          </p>
          <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <CalendarClock className="size-2.5" />
            <span>{startLabel}</span>
            <span className="opacity-60">·</span>
            <span>
              {row.qty ?? ""} {row.step_count} step
              {row.step_count === 1 ? "" : "s"}
            </span>
          </p>
        </div>
      </button>
    </li>
  );
}

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  draft: {
    label: "Draft",
    className: "bg-muted text-muted-foreground",
  },
  prepared: {
    label: "Prepared",
    className: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  approved: {
    label: "Approved",
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  },
  scheduled: {
    label: "Scheduled",
    className: "bg-brand/15 text-brand",
  },
  in_progress: {
    label: "In progress",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
};

function TreeRow({
  node,
  canEdit,
  company,
  depth,
  onQuickSchedule,
}: {
  node: TreeNode;
  canEdit: boolean;
  company: CompanyDefaults;
  depth: number;
  onQuickSchedule?: (mo: BacklogMO, isProject: boolean) => void;
}) {
  // Collapsed by default so the rail stays compact — planner
  // expands only the projects they want to break apart.
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.children.length > 0;
  const hasSteps = node.mo.steps_summary.length > 0;
  const isProjectRoot = depth === 0 && hasChildren;
  const projectRowFlag = isProjectRoot;

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
        onQuickSchedule={
          onQuickSchedule
            ? () => onQuickSchedule(node.mo, projectRowFlag)
            : undefined
        }
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
                onQuickSchedule={onQuickSchedule}
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
  onQuickSchedule,
}: {
  mo: BacklogMO;
  canEdit: boolean;
  company: CompanyDefaults;
  depth: number;
  dragKind: "project" | "mo";
  expanded: boolean;
  canToggle: boolean;
  onToggle: () => void;
  onQuickSchedule?: () => void;
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
          {onQuickSchedule && canEdit && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onQuickSchedule();
              }}
              className="shrink-0 rounded p-0.5 text-amber-600 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-950/50"
              title="Quick schedule — type a start time or pick a free slot"
              aria-label="Quick schedule"
            >
              <Zap className="size-3" />
            </button>
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

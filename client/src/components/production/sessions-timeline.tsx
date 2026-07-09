"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Factory, FileText, HelpCircle, History, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import type { CompanyDefaults } from "@/lib/types";
import { formatCompanyDate, formatCompanyNumber } from "@/lib/format/company";
import { UserAvatar } from "@/components/users/user-avatar";
import { Badge } from "@/components/ui/badge-mini";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { WorkstationSessionRow } from "@/lib/production/sessions";
import { LiveTimer } from "./live-timer";

interface Props {
  sessions: WorkstationSessionRow[];
  prefs: CompanyDefaults;
  /** Show a "MO #<id>" chip on each row — used on the CO wizard where
   *  sessions from many MOs blend into one story. */
  showMOContext?: boolean;
  /** Rendering mode:
   *   - "grouped" (default) — sessions on the same MO step collapse
   *     into an expandable card. Best for MO / CO / run views where
   *     one operation may run multiple times and the wall of
   *     repeats otherwise buries the story.
   *   - "chronological" — flat feed, one row per session in server
   *     order. Best for per-employee views ("what did they do over
   *     time") where the operator is the story, not the step. */
  mode?: "grouped" | "chronological";
}

type Kind = WorkstationSessionRow["activity_kind"];

const KIND_ICON = { mo: Factory, cleaning: Sparkles, maintenance: Wrench, other: HelpCircle } as const;

const KIND_TONE: Record<Kind, { bg: string; icon: string; chip: string }> = {
  mo: { bg: "bg-indigo-500/15", icon: "text-indigo-700 dark:text-indigo-400", chip: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400" },
  cleaning: { bg: "bg-sky-500/15", icon: "text-sky-700 dark:text-sky-400", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  maintenance: { bg: "bg-amber-500/15", icon: "text-amber-700 dark:text-amber-400", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  other: { bg: "bg-muted", icon: "text-muted-foreground", chip: "bg-muted text-muted-foreground" },
};

const KIND_LABEL: Record<Kind, string> = { mo: "Production", cleaning: "Cleaning", maintenance: "Maintenance", other: "Other" };

function formatDurationSeconds(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Local wall-clock HH:MM — the date sits once at the row footer. */
function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function truncate(s: string, max = 120): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Operation descriptions can run to full paragraphs on legacy MO
 *  steps. Rendering them inline on every session row explodes the
 *  timeline vertically — same failure mode the kiosk hit. Compact
 *  button on the row opens a modal with the full text. */
function OperationButton({ description, title }: { description: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-6 px-2 text-[10px] font-medium tracking-wide"
      >
        <FileText className="mr-1 size-3" aria-hidden />
        View operation
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="size-4 text-muted-foreground" aria-hidden />
              Operation · {title}
            </DialogTitle>
            <DialogDescription>
              Procedure text captured on this MO step. Read-only.
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/30 p-4 font-sans text-sm leading-relaxed">
            {description}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}

function perfTone(pct: number): "emerald" | "amber" | "destructive" {
  if (pct >= 90) return "emerald";
  if (pct >= 70) return "amber";
  return "destructive";
}

function StatusPill({ session }: { session: WorkstationSessionRow }) {
  if (session.status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
        <span className="size-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
        Running
        <LiveTimer
          startedAt={session.started_at}
          finishedAt={session.finished_at}
          className="ml-1 text-[11px] font-medium normal-case tracking-normal"
        />
      </span>
    );
  }
  if (session.status === "verified") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
        <ShieldCheck className="size-3" aria-hidden /> Verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      <Check className="size-3" aria-hidden /> Completed
    </span>
  );
}

function WorkerChips({ workers }: { workers: string[] }) {
  if (workers.length === 0) {
    return <span className="text-[11px] italic text-muted-foreground">unattributed</span>;
  }
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label="Operators">
      {workers.map((name) => (
        <li
          key={name}
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 py-0.5 pl-0.5 pr-2 text-[11px]"
        >
          <UserAvatar name={name} email={name} sizeClassName="size-4" fallbackClassName="text-[8px]" />
          <span className="max-w-[10rem] truncate">{name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Chronological session story — the shop-floor equivalent of the
 * equipment lifecycle timeline. Reused by the MO detail page (a
 * single MO's sessions) and the CO wizard (many MOs blended, via
 * `showMOContext`).
 *
 * Server sorts newest-first. Renderer never re-sorts — operator on
 * the kiosk and manager on the desk must agree on order.
 */
/** Group key that determines whether two sessions collapse into one
 *  card. Anchored on mo_uuid + step_uuid — same operation on the
 *  same MO. Off-MO sessions (cleaning / maintenance / other) never
 *  group; they stay individual because "cleaning happened at 09:00"
 *  and "cleaning happened at 14:00" are two independent events. */
function groupKeyOf(s: WorkstationSessionRow): string | null {
  const step = s.manufacturing_order_step;
  if (!step?.manufacturing_order_uuid || !step?.uuid) return null;
  return `${step.manufacturing_order_uuid}::${step.uuid}`;
}

interface SessionGroup {
  key: string;
  sessions: WorkstationSessionRow[];
}

function groupSessions(sessions: WorkstationSessionRow[]): SessionGroup[] {
  const groups: SessionGroup[] = [];
  const byKey = new Map<string, SessionGroup>();

  sessions.forEach((s, idx) => {
    const key = groupKeyOf(s);
    if (!key) {
      // Off-MO — never groupable. Unique key so each renders as its
      // own single-item group.
      groups.push({ key: `solo:${s.uuid}:${idx}`, sessions: [s] });
      return;
    }
    let g = byKey.get(key);
    if (!g) {
      g = { key, sessions: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.sessions.push(s);
  });

  return groups;
}

function sumDurationSeconds(sessions: WorkstationSessionRow[]): number {
  return sessions.reduce((acc, s) => acc + (s.duration_seconds ?? 0), 0);
}

function sumProduced(sessions: WorkstationSessionRow[]): number {
  return sessions.reduce((acc, s) => acc + (s.quantity_produced ? Number(s.quantity_produced) : 0), 0);
}

function GroupSummaryRow({
  group,
  prefs,
  showMOContext,
}: {
  group: SessionGroup;
  prefs: CompanyDefaults;
  showMOContext: boolean;
}) {
  const first = group.sessions[0]!;
  const step = first.manufacturing_order_step;
  const title = step?.workstation_group_name || KIND_LABEL[first.activity_kind];
  const tone = KIND_TONE[first.activity_kind];
  const Icon = KIND_ICON[first.activity_kind] ?? HelpCircle;
  const anyRunning = group.sessions.some((s) => s.status === "active");
  const totalDuration = sumDurationSeconds(group.sessions);
  const totalProduced = sumProduced(group.sessions);
  const operators = Array.from(new Set(group.sessions.flatMap((s) => s.workers))).slice(0, 5);
  const workstationNames = Array.from(
    new Set(group.sessions.map((s) => s.workstation?.name).filter(Boolean)),
  ) as string[];

  return (
    <li role="listitem" className="relative">
      <span
        className={cn(
          "absolute -left-[27px] top-1.5 inline-flex size-6 items-center justify-center rounded-full ring-2 ring-background",
          tone.bg,
        )}
      >
        <Icon className={cn("size-3.5", tone.icon)} aria-hidden />
      </span>

      <details className="group/details rounded-md border border-border/60 bg-background/40 open:bg-card">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded-md px-3 py-2 hover:bg-muted/40">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <h3 className="truncate text-xs font-semibold uppercase tracking-wide">{title}</h3>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                tone.chip,
              )}
            >
              {KIND_LABEL[first.activity_kind]}
            </span>
            {step?.sort_order != null && (
              <span className="text-[10px] font-medium text-muted-foreground">Step {step.sort_order}</span>
            )}
            {showMOContext && step?.manufacturing_order_uuid && step?.manufacturing_order_id != null && (
              <Link
                href={`/production/manufacturing-orders/${step.manufacturing_order_uuid}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand hover:bg-brand/20"
              >
                MO #{step.manufacturing_order_id}
              </Link>
            )}
            <span className="inline-flex items-center rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {group.sessions.length} runs
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {workstationNames.length > 0 && (
              <span className="hidden truncate sm:inline">
                {workstationNames.slice(0, 2).join(", ")}
                {workstationNames.length > 2 && ` +${workstationNames.length - 2}`}
              </span>
            )}
            {totalProduced > 0 && (
              <span className="hidden font-medium text-foreground sm:inline">
                {formatCompanyNumber(totalProduced, prefs)} units
              </span>
            )}
            {totalDuration > 0 && (
              <span className="font-mono tabular-nums">{formatDurationSeconds(totalDuration)}</span>
            )}
            {anyRunning ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
                Running
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Check className="size-3" aria-hidden /> Completed
              </span>
            )}
          </div>
        </summary>

        <div className="border-t border-border/60 px-3 py-3">
          {operators.length > 0 && (
            <div className="mb-3 flex flex-wrap items-baseline gap-1.5 text-[11px]">
              <span className="text-muted-foreground">Operators</span>
              <WorkerChips workers={operators} />
            </div>
          )}
          <ul className="space-y-3">
            {group.sessions.map((s) => (
              <SessionRow key={s.uuid} s={s} prefs={prefs} showMOContext={false} compact />
            ))}
          </ul>
        </div>
      </details>
    </li>
  );
}

function SessionRow({
  s,
  prefs,
  showMOContext,
  compact = false,
}: {
  s: WorkstationSessionRow;
  prefs: CompanyDefaults;
  showMOContext: boolean;
  /** Nested rendering inside a group — drops the icon rail dot and
   *  the group-info that's already shown on the group header. */
  compact?: boolean;
}) {
  const tone = KIND_TONE[s.activity_kind];
  const Icon = KIND_ICON[s.activity_kind] ?? HelpCircle;
  const step = s.manufacturing_order_step;
  const title = step?.workstation_group_name || s.activity_label || KIND_LABEL[s.activity_kind];
  const produced = s.quantity_produced !== null ? Number(s.quantity_produced) : null;
  const rejected = s.quantity_rejected !== null ? Number(s.quantity_rejected) : null;
  const perf = s.performance_percentage;
  const opDesc = step?.operation_description;

  return (
    <li role="listitem" className="relative">
      {!compact && (
        <span
          className={cn(
            "absolute -left-[27px] top-1.5 inline-flex size-6 items-center justify-center rounded-full ring-2 ring-background",
            tone.bg,
          )}
        >
          <Icon className={cn("size-3.5", tone.icon)} aria-hidden />
        </span>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {!compact && (
              <>
                <h3 className="truncate text-xs font-semibold uppercase tracking-wide">{title}</h3>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    tone.chip,
                  )}
                >
                  {KIND_LABEL[s.activity_kind]}
                </span>
                {step?.sort_order != null && (
                  <span className="text-[10px] font-medium text-muted-foreground">Step {step.sort_order}</span>
                )}
                {showMOContext && step?.manufacturing_order_uuid && step?.manufacturing_order_id != null && (
                  <Link
                    href={`/production/manufacturing-orders/${step.manufacturing_order_uuid}`}
                    className="inline-flex items-center rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand hover:bg-brand/20"
                  >
                    MO #{step.manufacturing_order_id}
                  </Link>
                )}
              </>
            )}
            {compact && (
              <span className="text-[11px] font-medium text-muted-foreground">
                Run at {formatClock(s.started_at)}
                {s.finished_at && ` – ${formatClock(s.finished_at)}`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {s.status !== "active" && (
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {formatDurationSeconds(s.duration_seconds)}
              </span>
            )}
            <StatusPill session={s} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-baseline gap-1.5">
            <span className="text-muted-foreground">Workstation</span>
            <span className="font-medium">{s.workstation?.name ?? "—"}</span>
            {s.workstation?.code && (
              <span className="text-[10px] text-muted-foreground">({s.workstation.code})</span>
            )}
          </div>
          <div className="flex items-baseline gap-1.5 sm:col-span-1 lg:col-span-2">
            <span className="text-muted-foreground">Operators</span>
            <WorkerChips workers={s.workers} />
          </div>
          {produced !== null && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-muted-foreground">Produced</span>
              <span className="font-medium">{formatCompanyNumber(produced, prefs)} units</span>
            </div>
          )}
          {rejected !== null && rejected > 0 && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-muted-foreground">Rejected</span>
              <span className="font-medium text-red-700 dark:text-red-400">
                {formatCompanyNumber(rejected, prefs)} units
              </span>
            </div>
          )}
          {perf !== null && (
            <div className="flex items-baseline justify-start gap-1.5 sm:justify-end">
              <span className="text-muted-foreground">Performance</span>
              <Badge tone={perfTone(perf)}>{perf.toFixed(1)}%</Badge>
            </div>
          )}
        </div>

        {opDesc && <OperationButton description={opDesc} title={title} />}

        {s.notes && (
          <blockquote className="mt-1 border-l-2 border-border/60 pl-2 text-[11px] italic text-muted-foreground">
            &ldquo;{s.notes}&rdquo;
          </blockquote>
        )}

        {!compact && (
          <p className="text-[10px] text-muted-foreground">
            Started {formatCompanyDate(s.started_at, prefs)} at {formatClock(s.started_at)}
            {s.finished_at && <> · Finished {formatClock(s.finished_at)}</>}
          </p>
        )}
      </div>
    </li>
  );
}

export function SessionsTimeline({ sessions, prefs, showMOContext = false, mode = "grouped" }: Props) {
  const hasRunning = sessions.some((s) => s.status === "active");

  if (sessions.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-border/60 bg-card/40 p-8 text-center shadow-sm">
        <div className="mx-auto mb-3 inline-flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <History className="size-5" aria-hidden />
        </div>
        <h2 className="text-sm font-semibold">No production sessions yet</h2>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Sessions appear here as operators clock in at the kiosk.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Session story</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
        </span>
      </header>

      <ul
        role="list"
        aria-live={hasRunning ? "polite" : "off"}
        className="relative space-y-4 border-l border-border/60 pl-6"
      >
        {mode === "chronological"
          ? sessions.map((s) => (
              <SessionRow key={s.uuid} s={s} prefs={prefs} showMOContext={showMOContext} />
            ))
          : groupSessions(sessions).map((g) =>
              g.sessions.length > 1 ? (
                <GroupSummaryRow
                  key={g.key}
                  group={g}
                  prefs={prefs}
                  showMOContext={showMOContext}
                />
              ) : (
                <SessionRow
                  key={g.sessions[0]!.uuid}
                  s={g.sessions[0]!}
                  prefs={prefs}
                  showMOContext={showMOContext}
                />
              ),
            )}
      </ul>
    </section>
  );
}

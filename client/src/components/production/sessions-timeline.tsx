"use client";

import Link from "next/link";
import { Check, Factory, HelpCircle, History, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import type { CompanyDefaults } from "@/lib/types";
import { formatCompanyDate, formatCompanyNumber } from "@/lib/format/company";
import { UserAvatar } from "@/components/users/user-avatar";
import { Badge } from "@/components/ui/badge-mini";
import { cn } from "@/lib/utils";
import type { WorkstationSessionRow } from "@/lib/production/sessions";
import { LiveTimer } from "./live-timer";

interface Props {
  sessions: WorkstationSessionRow[];
  prefs: CompanyDefaults;
  /** Show a "MO #<id>" chip on each row — used on the CO wizard where
   *  sessions from many MOs blend into one story. */
  showMOContext?: boolean;
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
export function SessionsTimeline({ sessions, prefs, showMOContext = false }: Props) {
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
        {sessions.map((s) => {
          const tone = KIND_TONE[s.activity_kind];
          const Icon = KIND_ICON[s.activity_kind] ?? HelpCircle;
          const step = s.manufacturing_order_step;
          const title = step?.workstation_group_name || s.activity_label || KIND_LABEL[s.activity_kind];
          const produced = s.quantity_produced !== null ? Number(s.quantity_produced) : null;
          const rejected = s.quantity_rejected !== null ? Number(s.quantity_rejected) : null;
          const perf = s.performance_percentage;
          const opDesc = step?.operation_description;

          return (
            <li key={s.uuid} role="listitem" className="relative">
              <span
                className={cn(
                  "absolute -left-[27px] top-1.5 inline-flex size-6 items-center justify-center rounded-full ring-2 ring-background",
                  tone.bg,
                )}
              >
                <Icon className={cn("size-3.5", tone.icon)} aria-hidden />
              </span>

              <div className="space-y-2">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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

                {opDesc && (
                  <p className="text-[11px] text-muted-foreground" title={opDesc}>
                    <span className="font-medium">Operation:</span> {truncate(opDesc, 120)}
                  </p>
                )}

                {s.notes && (
                  <blockquote className="mt-1 border-l-2 border-border/60 pl-2 text-[11px] italic text-muted-foreground">
                    “{s.notes}”
                  </blockquote>
                )}

                <p className="text-[10px] text-muted-foreground">
                  Started {formatCompanyDate(s.started_at, prefs)} at {formatClock(s.started_at)}
                  {s.finished_at && <> · Finished {formatClock(s.finished_at)}</>}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

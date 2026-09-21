import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ChevronLeft,
  CalendarDays,
  Clock,
  Gauge,
  Sparkles,
  BedDouble,
  Layers,
  Award,
  MessageSquareText,
} from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getHREmployee, getShiftDetail } from "@/lib/hr/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import { LiveTimer } from "@/components/production/live-timer";
import type { ShiftActivityKind, ShiftDetail } from "@/lib/hr/types";
import { ShiftTimeline } from "./shift-timeline";

export const metadata = { title: "Shift · HR · PSP" };
export const dynamic = "force-dynamic";

/** Human-readable label per activity kind — matches vp's kiosk copy. */
const ACTIVITY_LABEL: Record<ShiftActivityKind, string> = {
  mo: "Production",
  cleaning: "Cleaning",
  maintenance: "Maintenance",
  other: "Other",
};

/** Timeline dot + card accent per activity kind. Muted tokens on
 *  purpose — the page is data-dense and hue-loud dots read as noise. */
const ACTIVITY_CLASSES: Record<
  ShiftActivityKind,
  { dot: string; chip: string; ring: string }
> = {
  mo: {
    dot: "bg-sky-500",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    ring: "ring-sky-500/30",
  },
  cleaning: {
    dot: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    ring: "ring-amber-500/30",
  },
  maintenance: {
    dot: "bg-violet-500",
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    ring: "ring-violet-500/30",
  },
  other: {
    dot: "bg-slate-400",
    chip: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
    ring: "ring-slate-500/30",
  },
};

function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${rem}s`;
  return `${s}s`;
}

function percent(part: number, whole: number): string {
  if (whole <= 0) return "—";
  const pct = (part / whole) * 100;
  return `${pct.toFixed(0)}%`;
}

/** Delta chip vs rolling average. Positive = worked more than usual,
 *  negative = worked less. Renders "—" when there's nothing to compare
 *  against (first shift, no window rows). */
function DeltaVsAverage({
  current,
  average,
}: {
  current: number;
  average: number;
}) {
  if (average <= 0) {
    return (
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        No baseline
      </span>
    );
  }
  const delta = current - average;
  const pct = Math.round((delta / average) * 100);
  const sign = delta === 0 ? "" : delta > 0 ? "+" : "";
  const tone =
    delta === 0
      ? "text-muted-foreground"
      : delta > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-amber-600 dark:text-amber-400";
  return (
    <span className={`text-[10px] uppercase tracking-wide ${tone}`}>
      {sign}
      {pct}% vs 30-day avg
    </span>
  );
}

export default async function ShiftDetailPage({
  params,
}: {
  params: Promise<{ uuid: string; shiftUuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "hr.view")) redirect("/");

  const { uuid, shiftUuid } = await params;

  const [employee, prefs, detail] = await Promise.all([
    getHREmployee(uuid),
    getCompanyDefaults(),
    getShiftDetail(uuid, shiftUuid),
  ]);

  if (!employee) notFound();

  // vp unreachable, no linkage, or 404 — render a soft-fail shell
  // instead of hard-404ing so the operator can still get back.
  const missing = detail === null;

  return (
    <div className="mx-auto w-full space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <BackTrail employee={employee} />

      {missing ? (
        <ShiftDetailUnavailable employeeUuid={uuid} />
      ) : (
        <>
          <ShiftHeader detail={detail!} prefs={prefs} employeeName={employee.full_name} />
          <DashboardGrid detail={detail!} />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <TimelineCard detail={detail!} prefs={prefs} />
            <div className="space-y-6">
              <ActivityBreakdownCard detail={detail!} />
              <ReputationEventsCard detail={detail!} prefs={prefs} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BackTrail({
  employee,
}: {
  employee: { uuid: string; full_name: string };
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Button asChild size="sm" variant="ghost" className="-ml-2 h-7 gap-1 px-2">
        <Link href={`/hr/employees/${employee.uuid}`}>
          <ChevronLeft className="size-3.5" aria-hidden />
          {employee.full_name}
        </Link>
      </Button>
      <span aria-hidden>/</span>
      <span>Shift detail</span>
    </div>
  );
}

function ShiftDetailUnavailable({ employeeUuid }: { employeeUuid: string }) {
  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="text-base">Shift detail is unavailable</CardTitle>
        <CardDescription>
          vita-performance couldn&apos;t hand us the session-level
          breakdown for this shift. This usually means one of: (1) the
          shift envelope hasn&apos;t been mirrored yet, (2) the
          integration secret is missing on PSP, or (3) vita-performance
          isn&apos;t reachable from PSP right now.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild size="sm" variant="outline">
          <Link href={`/hr/employees/${employeeUuid}`}>Back to employee</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ShiftHeader({
  detail,
  prefs,
  employeeName,
}: {
  detail: ShiftDetail;
  prefs: FormatPrefs | null;
  employeeName: string;
}) {
  const { shift } = detail;
  const open = shift.is_open;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-4">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">
            {employeeName}
          </h1>
          {open ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              <span
                className="size-1.5 animate-pulse rounded-full bg-emerald-500"
                aria-hidden
              />
              Live shift
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Closed
            </span>
          )}
        </div>
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5" aria-hidden />
            {formatCompanyDate(shift.clocked_in_at, prefs)}
          </span>
          <span className="font-mono tabular-nums text-foreground/80">
            {formatClock(shift.clocked_in_at)}
            {" → "}
            {open ? "now" : formatClock(shift.clocked_out_at)}
          </span>
          {shift.device_id && (
            <span className="text-[11px] text-muted-foreground/70">
              tablet · {shift.device_id}
            </span>
          )}
        </p>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Total shift
        </div>
        {open ? (
          <LiveTimer
            startedAt={shift.clocked_in_at ?? new Date().toISOString()}
            finishedAt={shift.clocked_out_at}
            className="text-xl font-semibold tabular-nums"
          />
        ) : (
          <div className="text-xl font-semibold tabular-nums">
            {formatDuration(shift.duration_seconds)}
          </div>
        )}
      </div>
    </div>
  );
}

function DashboardGrid({ detail }: { detail: ShiftDetail }) {
  const { summary, rolling_average } = detail;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={<Gauge className="size-4" aria-hidden />}
        label="Working"
        value={formatDuration(summary.working_seconds)}
        sub={percent(summary.working_seconds, summary.total_shift_seconds)}
        after={
          <DeltaVsAverage
            current={summary.working_seconds}
            average={rolling_average.avg_working_seconds_per_shift}
          />
        }
      />
      <StatCard
        icon={<BedDouble className="size-4" aria-hidden />}
        label="Idle"
        value={formatDuration(summary.idle_seconds)}
        sub={percent(summary.idle_seconds, summary.total_shift_seconds)}
        after={
          <DeltaVsAverage
            current={summary.idle_seconds}
            average={rolling_average.avg_idle_seconds_per_shift}
          />
        }
      />
      <StatCard
        icon={<Layers className="size-4" aria-hidden />}
        label="Sessions"
        value={String(summary.sessions_completed + summary.sessions_active)}
        sub={
          summary.sessions_active > 0
            ? `${summary.sessions_completed} closed · ${summary.sessions_active} running`
            : `${summary.sessions_completed} closed`
        }
        after={
          <DeltaVsAverage
            current={summary.sessions_completed + summary.sessions_active}
            average={rolling_average.avg_sessions_per_shift}
          />
        }
      />
      <StatCard
        icon={<Sparkles className="size-4" aria-hidden />}
        label="Reputation this shift"
        value={
          detail.reputation_events.length === 0
            ? "0"
            : String(detail.reputation_events.length)
        }
        sub={
          detail.reputation_events.length === 0
            ? "No feedback events"
            : `${detail.reputation_events.length} event${
                detail.reputation_events.length === 1 ? "" : "s"
              }`
        }
        after={
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {`30-day window · ${rolling_average.shifts_counted} peer shift${
              rolling_average.shifts_counted === 1 ? "" : "s"
            }`}
          </span>
        }
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  after,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  after?: React.ReactNode;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="space-y-2 py-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        {sub && (
          <div className="text-[11px] text-muted-foreground">{sub}</div>
        )}
        {after && <div>{after}</div>}
      </CardContent>
    </Card>
  );
}

function ActivityBreakdownCard({ detail }: { detail: ShiftDetail }) {
  const { by_activity_kind } = detail.summary;
  const total = detail.summary.working_seconds || 1; // avoid /0
  const kinds: ShiftActivityKind[] = ["mo", "cleaning", "maintenance", "other"];
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Award className="size-4 text-muted-foreground" aria-hidden />
          Activity breakdown
        </CardTitle>
        <CardDescription className="text-[11px]">
          Working time split by session kind. Idle gaps are not counted
          here — see the &ldquo;Idle&rdquo; card above.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {kinds.map((k) => {
          const row = by_activity_kind[k] ?? { count: 0, seconds: 0 };
          const share = (row.seconds / total) * 100;
          const cls = ACTIVITY_CLASSES[k];
          return (
            <div key={k} className="space-y-1">
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="inline-flex items-center gap-2">
                  <span
                    className={`size-2 rounded-full ${cls.dot}`}
                    aria-hidden
                  />
                  <span className="font-medium">{ACTIVITY_LABEL[k]}</span>
                  <span className="text-muted-foreground">
                    · {row.count} session{row.count === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {formatDuration(row.seconds)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted/40">
                <div
                  className={`h-full ${cls.dot}`}
                  style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
                  aria-hidden
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ReputationEventsCard({
  detail,
  prefs: _prefs,
}: {
  detail: ShiftDetail;
  prefs: FormatPrefs | null;
}) {
  const events = detail.reputation_events;
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <MessageSquareText className="size-4 text-muted-foreground" aria-hidden />
          Reputation events
        </CardTitle>
        <CardDescription className="text-[11px]">
          Feedback fired during this shift window.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No reputation events during this shift.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {events.map((ev) => (
              <li key={ev.id} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium">
                    {ev.kind ?? "event"}
                  </span>
                  {typeof ev.delta === "number" && (
                    <span
                      className={
                        ev.delta >= 0
                          ? "text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"
                          : "text-[10px] font-semibold text-red-600 dark:text-red-400"
                      }
                    >
                      {ev.delta > 0 ? "+" : ""}
                      {ev.delta}
                    </span>
                  )}
                </div>
                {ev.reason && (
                  <p className="text-[11px] text-muted-foreground">
                    {ev.reason}
                  </p>
                )}
                <div className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
                  {formatClock(ev.created_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TimelineCard({
  detail,
  prefs,
}: {
  detail: ShiftDetail;
  prefs: FormatPrefs | null;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Clock className="size-4 text-muted-foreground" aria-hidden />
          Session timeline
        </CardTitle>
        <CardDescription className="text-[11px]">
          Chronological, top-down. Idle gaps between sessions are shown
          as thin muted rows.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ShiftTimeline detail={detail} prefs={prefs} />
      </CardContent>
    </Card>
  );
}

import { Sparkles, Wrench, ClipboardCheck, AlertTriangle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import { listWorkstationEvents } from "@/lib/production/audit-events";
import type {
  WorkstationEventPage,
  WorkstationEventRow,
} from "@/lib/production/audit-events";
import { CleaningMaintenanceHistory } from "./cleaning-maintenance-history";

interface Props {
  workstationUuid: string;
  workstationName: string;
  prefs: FormatPrefs | null;
}

/** Human-friendly cadence chip label. Renders "every 2 weeks" from
 *  ``{periodicity: "weekly", interval: 2}``. */
function cadenceLabel(
  periodicity: string | null,
  interval: number | null,
): string | null {
  if (!periodicity || !interval || interval <= 0) return null;
  const unit: Record<string, string> = {
    daily: "day",
    weekly: "week",
    monthly: "month",
    quarterly: "quarter",
    half_yearly: "6-month period",
    yearly: "year",
    two_yearly: "2 years",
    three_yearly: "3 years",
  };
  const u = unit[periodicity] ?? periodicity;
  if (interval === 1) return `Every ${u}`;
  return `Every ${interval} ${u}s`;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  const day = 1000 * 60 * 60 * 24;
  const t0 = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
  ).getTime();
  const t1 = new Date(
    Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()),
  ).getTime();
  return Math.round((t1 - t0) / day);
}

function DueChip({
  label,
  lastAt,
  nextAt,
  cadence,
  prefs,
  tone,
}: {
  label: string;
  lastAt: string | null;
  nextAt: string | null;
  cadence: string | null;
  prefs: FormatPrefs | null;
  tone: "cleaning" | "maintenance";
}) {
  const days = daysUntil(nextAt);
  const overdue = days !== null && days < 0;
  const dueSoon = days !== null && days >= 0 && days <= 3;

  const iconTone =
    tone === "cleaning"
      ? "text-amber-600 dark:text-amber-400"
      : "text-violet-600 dark:text-violet-400";

  const Icon = tone === "cleaning" ? Sparkles : Wrench;

  return (
    <div className="rounded-md border border-border/60 bg-background/60 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className={`size-3.5 ${iconTone}`} aria-hidden />
          {label}
        </div>
        {cadence && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {cadence}
          </span>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Last</dt>
        <dd className="text-right font-mono tabular-nums">
          {lastAt ? formatCompanyDate(lastAt, prefs) : "—"}
        </dd>
        <dt className="text-muted-foreground">Next due</dt>
        <dd className="text-right font-mono tabular-nums">
          {nextAt ? formatCompanyDate(nextAt, prefs) : "—"}
        </dd>
      </dl>
      {overdue && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
          <AlertTriangle className="size-3" aria-hidden />
          {Math.abs(days!)} day{Math.abs(days!) === 1 ? "" : "s"} overdue
        </div>
      )}
      {!overdue && dueSoon && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
          Due in {days} day{days === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}

/** Full-width Cleaning & Maintenance section on the workstation
 *  detail page. Renders three parts: cadence chips (last + next
 *  due + overdue banner), a small counter row (total events + how
 *  many of each kind), and the paginated history. */
export async function CleaningMaintenanceSection({
  workstationUuid,
  workstationName: _workstationName,
  prefs,
}: Props) {
  const page: WorkstationEventPage | null = await listWorkstationEvents(
    workstationUuid,
    { limit: 20 },
  );

  if (!page) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="text-base">
            Cleaning & Maintenance is unavailable
          </CardTitle>
          <CardDescription>
            The audit-events service is not reachable right now. Try
            reloading in a minute.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { workstation, items, next_cursor } = page;
  const cleaningRows = items.filter(
    (r: WorkstationEventRow) =>
      r.kind === "cleaning_completed" || r.kind === "cleaning_started",
  );
  const maintRows = items.filter(
    (r: WorkstationEventRow) =>
      r.kind === "maintenance_completed" || r.kind === "maintenance_started",
  );

  const cleaningCadence = cadenceLabel(
    workstation.cleaning_periodicity,
    workstation.cleaning_periodicity_interval,
  );
  const maintCadence = cadenceLabel(
    workstation.maintenance_periodicity,
    workstation.maintenance_periodicity_interval,
  );

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardCheck
            className="size-4 text-muted-foreground"
            aria-hidden
          />
          Cleaning &amp; Maintenance
        </CardTitle>
        <CardDescription className="text-[12px]">
          Compliance record for this workstation. Cleaning + maintenance
          sessions kicked off on the kiosk land here as immutable audit
          rows. Auditor asks &ldquo;how often do you clean / maintain
          this workstation&rdquo; — this is the answer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <DueChip
            label="Cleaning schedule"
            lastAt={workstation.last_cleaning_at}
            nextAt={workstation.next_cleaning_due_at}
            cadence={cleaningCadence}
            prefs={prefs}
            tone="cleaning"
          />
          <DueChip
            label="Maintenance schedule"
            lastAt={workstation.last_maintenance_at}
            nextAt={workstation.next_maintenance_due_at}
            cadence={maintCadence}
            prefs={prefs}
            tone="maintenance"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryPill
            label="Total events"
            value={items.length + (next_cursor ? "+" : "")}
            hint={next_cursor ? "Scroll to load more" : "All history shown"}
          />
          <SummaryPill
            label="Cleaning"
            value={cleaningRows.length}
            tone="cleaning"
          />
          <SummaryPill
            label="Maintenance"
            value={maintRows.length}
            tone="maintenance"
          />
        </div>

        <CleaningMaintenanceHistory
          workstationUuid={workstationUuid}
          initialItems={items}
          initialCursor={next_cursor}
          prefs={prefs}
        />
      </CardContent>
    </Card>
  );
}

function SummaryPill({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "cleaning" | "maintenance";
}) {
  const tint =
    tone === "cleaning"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "maintenance"
        ? "text-violet-700 dark:text-violet-400"
        : "";
  return (
    <div className="rounded-md border border-border/60 bg-background/60 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tint}`}>
        {value}
      </div>
      {hint && (
        <div className="text-[10px] text-muted-foreground/70">{hint}</div>
      )}
    </div>
  );
}

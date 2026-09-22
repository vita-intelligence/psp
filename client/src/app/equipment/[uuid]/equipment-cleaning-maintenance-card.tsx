import Link from "next/link";
import {
  Sparkles,
  Wrench,
  ClipboardCheck,
  AlertTriangle,
  History,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCompanyDate, type FormatPrefs } from "@/lib/format/company";
import type { Equipment, EquipmentEvent } from "@/lib/equipment/types";

interface Props {
  equipment: Equipment;
  events: EquipmentEvent[];
  prefs: FormatPrefs | null;
}

const CLEANING_KINDS = new Set(["cleaning_started", "cleaning_completed"]);
const MAINTENANCE_KINDS = new Set([
  "maintenance_started",
  "maintenance_completed",
]);

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

function monthsCadence(months: number | null): string | null {
  if (!months || months <= 0) return null;
  if (months === 1) return "Every month";
  if (months === 12) return "Every year";
  return `Every ${months} months`;
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
  const Icon = tone === "cleaning" ? Sparkles : Wrench;
  const iconTone =
    tone === "cleaning"
      ? "text-amber-600 dark:text-amber-400"
      : "text-violet-600 dark:text-violet-400";

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

const KIND_LABEL: Record<string, string> = {
  cleaning_completed: "Cleaning · completed",
  cleaning_started: "Cleaning · started",
  maintenance_completed: "Maintenance · completed",
  maintenance_started: "Maintenance · started",
};

const KIND_TONE: Record<string, string> = {
  cleaning_completed: "bg-amber-500",
  cleaning_started: "bg-amber-300",
  maintenance_completed: "bg-violet-500",
  maintenance_started: "bg-violet-300",
};

/** Full-width Cleaning & Maintenance card for the equipment
 *  detail page. Different scope from the workstation card — this
 *  one tracks the machine itself. Cadence chips + filtered history
 *  of cleaning + maintenance events on this specific piece. */
export function EquipmentCleaningMaintenanceCard({
  equipment,
  events,
  prefs,
}: Props) {
  const rows = events.filter(
    (e) => CLEANING_KINDS.has(e.kind) || MAINTENANCE_KINDS.has(e.kind),
  );

  const cleaningCadence = cadenceLabel(
    equipment.cleaning_periodicity,
    equipment.cleaning_periodicity_interval,
  );
  const maintCadence = monthsCadence(equipment.maintenance_frequency_months);

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardCheck
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            Cleaning &amp; Maintenance
          </CardTitle>
          <CardDescription className="text-[12px]">
            Compliance record for this machine. Every cleaning /
            maintenance session an operator ran against this specific
            serial number lands here as an immutable audit row.
            Distinct from the parent workstation&apos;s cleaning +
            maintenance log — cleaning the cell is not the same as
            cleaning the machine on it.
          </CardDescription>
        </div>
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link
            href={`/production/sessions?equipment_uuid=${equipment.uuid}`}
          >
            <History className="mr-1.5 size-4" />
            All submissions
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <DueChip
            label="Cleaning schedule"
            lastAt={equipment.last_cleaning_at}
            nextAt={equipment.next_cleaning_due_at}
            cadence={cleaningCadence}
            prefs={prefs}
            tone="cleaning"
          />
          <DueChip
            label="Maintenance schedule"
            lastAt={equipment.last_maintenance_at}
            nextAt={equipment.next_maintenance_at}
            cadence={maintCadence}
            prefs={prefs}
            tone="maintenance"
          />
        </div>

        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 py-6 text-center text-xs text-muted-foreground">
            No cleaning or maintenance events recorded on this machine
            yet.
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {rows.map((row) => (
              <li key={row.id} className="py-2.5">
                <EquipmentAuditRow row={row} prefs={prefs} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EquipmentAuditRow({
  row,
  prefs,
}: {
  row: EquipmentEvent;
  prefs: FormatPrefs | null;
}) {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const workstationName =
    typeof meta.workstation_name === "string" ? meta.workstation_name : null;
  const workerName =
    typeof meta.worker_name === "string" ? meta.worker_name : null;
  const durationRaw = meta.duration_seconds;
  const duration =
    typeof durationRaw === "number"
      ? durationRaw
      : typeof durationRaw === "string" && durationRaw !== ""
        ? Number.parseFloat(durationRaw)
        : null;

  const label = KIND_LABEL[row.kind] ?? row.kind;
  const dotTone = KIND_TONE[row.kind] ?? "bg-slate-400";

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={`mt-1 size-2 shrink-0 rounded-full ${dotTone}`}
          aria-hidden
        />
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
            {workstationName && (
              <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                {workstationName}
              </span>
            )}
          </div>
          <div className="text-xs">
            <span className="font-medium">
              {workerName || "Unknown operator"}
            </span>
            {row.reason && (
              <span className="ml-2 text-muted-foreground">— {row.reason}</span>
            )}
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right text-[11px]">
        <div className="text-muted-foreground">
          {formatCompanyDate(row.occurred_at, prefs)}
        </div>
        <div className="mt-0.5 font-mono tabular-nums">
          {formatDuration(duration)}
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import {
  Sparkles,
  Wrench,
  Cog,
  Settings2,
  AlertTriangle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getComplianceOverview } from "@/lib/production/compliance-overview";
import type {
  OverdueBucket,
  OverdueRow,
} from "@/lib/production/compliance-overview";

function daysOverdue(iso: string | null): number | null {
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
  return Math.floor((t0 - t1) / day);
}

/** Full-width Overdue Cleaning & Maintenance widget for the
 *  dashboard. Four buckets:
 *
 *    1. Workstations overdue for cleaning
 *    2. Workstations overdue for maintenance
 *    3. Equipment overdue for cleaning
 *    4. Equipment overdue for maintenance
 *
 *  Each bucket shows a count + the top 5 overdue rows with a
 *  deep-link. Empty state on a fully-compliant tenant hides the
 *  section entirely so the dashboard stays quiet when nothing
 *  needs attention. */
export async function ComplianceOverviewWidget() {
  const overview = await getComplianceOverview();
  if (!overview) return null;

  const total =
    overview.buckets.workstation_cleaning.count +
    overview.buckets.workstation_maintenance.count +
    overview.buckets.equipment_cleaning.count +
    overview.buckets.equipment_maintenance.count;

  if (total === 0) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-500/[0.04]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle
            className="size-4 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          Overdue Cleaning &amp; Maintenance
        </CardTitle>
        <CardDescription className="text-[12px]">
          Anything past its due date across every workstation and
          machine in the tenant. Auditor-grade traceability lives on
          each entity&apos;s detail page — jump straight from a row
          below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <BucketCard
            title="Workstation cleaning"
            icon={
              <div className="inline-flex items-center gap-1">
                <Settings2 className="size-3.5" aria-hidden />
                <Sparkles className="size-3.5" aria-hidden />
              </div>
            }
            bucket={overview.buckets.workstation_cleaning}
            targetPath="/production/workstations"
          />
          <BucketCard
            title="Workstation maintenance"
            icon={
              <div className="inline-flex items-center gap-1">
                <Settings2 className="size-3.5" aria-hidden />
                <Wrench className="size-3.5" aria-hidden />
              </div>
            }
            bucket={overview.buckets.workstation_maintenance}
            targetPath="/production/workstations"
          />
          <BucketCard
            title="Equipment cleaning"
            icon={
              <div className="inline-flex items-center gap-1">
                <Cog className="size-3.5" aria-hidden />
                <Sparkles className="size-3.5" aria-hidden />
              </div>
            }
            bucket={overview.buckets.equipment_cleaning}
            targetPath="/equipment"
          />
          <BucketCard
            title="Equipment maintenance"
            icon={
              <div className="inline-flex items-center gap-1">
                <Cog className="size-3.5" aria-hidden />
                <Wrench className="size-3.5" aria-hidden />
              </div>
            }
            bucket={overview.buckets.equipment_maintenance}
            targetPath="/equipment"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function BucketCard({
  title,
  icon,
  bucket,
  targetPath,
}: {
  title: string;
  icon: React.ReactNode;
  bucket: OverdueBucket;
  targetPath: string;
}) {
  const empty = bucket.count === 0;

  return (
    <div
      className={
        "rounded-md border bg-background/60 p-4 " +
        (empty
          ? "border-border/60"
          : "border-red-500/30 shadow-[0_0_0_1px_rgba(239,68,68,0.1)]")
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {icon}
          {title}
        </div>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <div
          className={
            "text-3xl font-semibold tabular-nums " +
            (empty
              ? "text-muted-foreground"
              : "text-red-600 dark:text-red-400")
          }
        >
          {bucket.count}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {bucket.count === 1 ? "overdue" : "overdue"}
        </div>
      </div>

      {empty ? (
        <p className="mt-2 text-[11px] text-muted-foreground/70">
          Nothing past due right now.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {bucket.preview.map((row) => (
            <PreviewRow key={row.uuid} row={row} targetPath={targetPath} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PreviewRow({ row, targetPath }: { row: OverdueRow; targetPath: string }) {
  const overdueDays = daysOverdue(row.due_at);
  return (
    <li>
      <Link
        href={`${targetPath}/${row.uuid}`}
        className="group flex items-baseline justify-between gap-3 rounded px-1 py-0.5 text-[11px] hover:bg-muted/40"
      >
        <span className="min-w-0 truncate font-medium underline-offset-2 group-hover:underline">
          {row.name}
        </span>
        {overdueDays !== null && (
          <span className="shrink-0 font-mono tabular-nums text-red-600 dark:text-red-400">
            {overdueDays}d overdue
          </span>
        )}
      </Link>
    </li>
  );
}

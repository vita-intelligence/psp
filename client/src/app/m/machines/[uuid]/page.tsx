import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  Boxes,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  Factory,
  PoundSterling,
  Tag,
  Wrench,
} from "lucide-react";
import { getDeviceToken } from "@/lib/devices/server";
import { getMachineForScan } from "@/lib/production/mobile";
import { getCompanyDefaults } from "@/lib/company/server";
import { formatCompanyDate, formatCompanyMoney } from "@/lib/format/company";

export const metadata = { title: "Machine · PSP Mobile" };

interface Props {
  params: Promise<{ uuid: string }>;
}

/**
 * Mobile machine detail page. Landed on by a QR scan from the
 * physical label; the operator holds the phone up to the machine
 * and sees:
 *
 *   - Which workstation it belongs to
 *   - Its per-hour running cost + calibration status
 *   - Manufacturer / model / serial for cross-reference against the
 *     nameplate
 *   - A big red banner when calibration is overdue (BRCGS 3.5.1 —
 *     using an out-of-cal instrument is an audit finding, so this
 *     needs to be the first thing they see)
 *
 * No editing on mobile — that's a floor-side identity check, not a
 * management surface. "Open on desktop" link routes back to the full
 * form for admins on a laptop.
 */
export default async function MobileMachinePage({ params }: Props) {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const { uuid } = await params;
  const [machine, prefs] = await Promise.all([
    getMachineForScan(uuid),
    getCompanyDefaults(),
  ]);
  if (!machine) notFound();

  const rate =
    machine.hourly_rate_enabled && machine.hourly_rate
      ? formatCompanyMoney(machine.hourly_rate, prefs ?? {})
      : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-3">
        <Link
          href="/m"
          className="rounded-md p-1.5 text-muted-foreground active:bg-muted"
          aria-label="Back to home"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-muted-foreground">
            {machine.asset_tag ?? `#${machine.id}`}
          </p>
          <p className="truncate text-sm font-semibold">{machine.name}</p>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4">
        {machine.calibration_overdue && (
          <section className="rounded-lg border border-red-500/60 bg-red-500/10 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-700 dark:text-red-300" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs font-semibold text-red-900 dark:text-red-100">
                  Calibration overdue
                </p>
                <p className="text-[11px] text-red-800/90 dark:text-red-200/90">
                  Do not use for food-safety-critical operations
                  (BRCGS Issue 9 §&nbsp;3.5.1). Log a Recalibrate event
                  before running production against this machine.
                </p>
              </div>
            </div>
          </section>
        )}

        {!machine.is_active && (
          <section className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Boxes className="size-4 shrink-0" />
              <span>Machine is archived — no longer part of any cost cascade.</span>
            </div>
          </section>
        )}

        {/* Attachment card — headline: what workstation this lives on. */}
        <section className="rounded-lg border border-border/60 bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Attached to
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Factory className="size-5 text-brand" />
            <span className="text-lg font-semibold">
              {machine.workstation?.name ?? "—"}
            </span>
          </div>
          {machine.workstation?.workstation_group?.name && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Group: {machine.workstation.workstation_group.name}
            </p>
          )}
        </section>

        {/* Cost + calibration side-by-side. */}
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border/60 bg-card p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Rate
            </p>
            <div className="mt-1 flex items-baseline gap-1">
              <PoundSterling className="size-3.5 text-muted-foreground" />
              <span className="text-lg font-semibold">
                {rate ?? <span className="text-muted-foreground/60">—</span>}
              </span>
              {rate && <span className="text-xs text-muted-foreground">/ h</span>}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Calibration due
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              {machine.calibration_overdue ? (
                <AlertTriangle className="size-3.5 text-red-600" />
              ) : machine.next_calibration_due_at ? (
                <CheckCircle2 className="size-3.5 text-emerald-600" />
              ) : (
                <Calendar className="size-3.5 text-muted-foreground" />
              )}
              <span
                className={
                  machine.calibration_overdue
                    ? "text-sm font-semibold text-red-700 dark:text-red-400"
                    : "text-sm font-semibold"
                }
              >
                {machine.next_calibration_due_at
                  ? formatCompanyDate(
                      machine.next_calibration_due_at,
                      prefs ?? {},
                    )
                  : "—"}
              </span>
            </div>
            {machine.last_calibrated_at && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Last: {formatCompanyDate(machine.last_calibrated_at, prefs ?? {})}
              </p>
            )}
          </div>
        </section>

        {/* Identity — what a worker checks against the nameplate. */}
        <section className="space-y-2 rounded-lg border border-border/60 bg-card p-4">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Identification
          </h2>
          <DetailRow icon={Wrench} label="Manufacturer" value={machine.manufacturer || "—"} />
          <DetailRow icon={Wrench} label="Model" value={machine.model || "—"} mono />
          <DetailRow
            icon={Tag}
            label="Asset tag"
            value={machine.asset_tag || "—"}
            mono
          />
          <DetailRow
            icon={Tag}
            label="Serial number"
            value={machine.serial_number || "—"}
            mono
          />
          {machine.commissioned_at && (
            <DetailRow
              icon={Calendar}
              label="Commissioned"
              value={formatCompanyDate(machine.commissioned_at, prefs ?? {})}
            />
          )}
        </section>

        {machine.notes && (
          <section className="space-y-1 rounded-lg border border-border/60 bg-card p-4">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
              Notes
            </h2>
            <p className="whitespace-pre-wrap text-sm">{machine.notes}</p>
          </section>
        )}

        <section className="space-y-2 pt-2">
          <Link
            href={`/production/machines/${machine.uuid}`}
            className="flex items-center justify-center rounded-lg border border-border/60 bg-card px-4 py-3 text-sm font-medium text-muted-foreground active:bg-muted"
          >
            Open full record on desktop →
          </Link>
        </section>
      </main>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p
          className={
            mono ? "truncate font-mono text-[13px]" : "truncate text-[13px]"
          }
        >
          {value}
        </p>
      </div>
    </div>
  );
}

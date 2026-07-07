import Link from "next/link";
import { redirect } from "next/navigation";
import { Cog, Plus, Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { Badge } from "@/components/ui/badge-mini";
import { Button } from "@/components/ui/button";
import { listEquipment, listEquipmentDueSoon } from "@/lib/equipment/server";
import type { EquipmentStatus } from "@/lib/equipment/types";
import { getCompanyDefaults } from "@/lib/company/server";
import { formatCompanyDate } from "@/lib/format/company";

export const metadata = { title: "Equipment · PSP" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<EquipmentStatus, string> = {
  expected: "Expected",
  received: "Received",
  in_service: "In service",
  under_maintenance: "Under maintenance",
  out_for_repair: "Out for repair",
  awaiting_calibration: "Awaiting calibration",
  retired: "Retired",
  disposed: "Disposed",
  canceled: "Cancelled",
};

const STATUS_TONE: Record<
  EquipmentStatus,
  "muted" | "indigo" | "emerald" | "amber" | "destructive" | "brand"
> = {
  expected: "indigo",
  received: "indigo",
  in_service: "emerald",
  under_maintenance: "amber",
  out_for_repair: "amber",
  awaiting_calibration: "amber",
  retired: "muted",
  disposed: "muted",
  canceled: "muted",
};

export default async function EquipmentLedgerPage() {
  const user = await requireUser();
  if (!hasPermission(user, "equipment.view")) {
    redirect("/");
  }

  const [list, dueSoon, prefs] = await Promise.all([
    listEquipment(),
    listEquipmentDueSoon(14),
    getCompanyDefaults(),
  ]);

  const units = list?.equipment ?? [];
  const dueRows = dueSoon?.rows ?? [];
  const overdueCount = dueRows.filter((r) => r.days_until < 0).length;

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            icon={Cog}
            title="Equipment"
            description="Serial-tracked units — mixers, scales, forklifts, laptops. Cadence-driven calibration + maintenance per BRCGS 4.13 / 4.11.6."
            actions={
              hasPermission(user, "equipment.create") ? (
                <Button asChild size="sm">
                  <Link href="/equipment/new">
                    <Plus className="mr-1.5 size-4" /> New equipment
                  </Link>
                </Button>
              ) : null
            }
          />

          {dueRows.length > 0 && (
            <section className="rounded-lg border border-amber-300/60 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
              <header className="mb-2 flex items-center gap-2">
                <Wrench className="size-4 text-amber-700" />
                <h2 className="text-sm font-semibold text-amber-900">
                  Due within 14 days
                </h2>
                <span className="ml-auto text-xs text-amber-900">
                  {dueRows.length} scheduled
                  {overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}
                </span>
              </header>
              <ul className="divide-y divide-amber-300/40">
                {dueRows.slice(0, 8).map((row, idx) => (
                  <li
                    key={`${row.equipment.uuid}-${row.due_kind}-${idx}`}
                    className="flex flex-wrap items-center gap-2 py-2 text-xs"
                  >
                    <Link
                      href={`/equipment/${row.equipment.uuid}`}
                      className="font-mono font-semibold text-amber-900 hover:underline"
                    >
                      {row.equipment.code ?? `#${row.equipment.id}`}
                    </Link>
                    <span className="text-amber-900/80">
                      {row.equipment.item?.name ?? "—"}
                    </span>
                    <span className="rounded bg-amber-500/20 px-1.5 text-[10px] font-medium uppercase tracking-wider text-amber-900">
                      {row.due_kind}
                    </span>
                    <span className="ml-auto font-mono text-amber-900">
                      {row.days_until < 0
                        ? `${Math.abs(row.days_until)} day(s) overdue`
                        : `in ${row.days_until} day(s)`}{" "}
                      · {formatCompanyDate(row.due_at, prefs)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-lg border border-border/60 bg-card shadow-sm">
            <header className="border-b border-border/60 px-4 py-3">
              <h2 className="text-sm font-semibold">
                All units{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({units.length})
                </span>
              </h2>
            </header>

            {units.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No equipment yet.{" "}
                {hasPermission(user, "equipment.create") && (
                  <Link href="/equipment/new" className="underline">
                    Add the first unit.
                  </Link>
                )}
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                <li className="grid grid-cols-[120px_minmax(0,1fr)_140px_120px_140px_140px] items-center gap-3 bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Code</span>
                  <span>Item / serial</span>
                  <span>Status</span>
                  <span>Cell</span>
                  <span>Next calibration</span>
                  <span>Next maintenance</span>
                </li>
                {units.map((u) => (
                  <li
                    key={u.uuid}
                    className="grid grid-cols-[120px_minmax(0,1fr)_140px_120px_140px_140px] items-center gap-3 px-4 py-2 text-sm"
                  >
                    <Link
                      href={`/equipment/${u.uuid}`}
                      className="font-mono text-xs font-semibold text-foreground hover:underline"
                    >
                      {u.code ?? `#${u.id}`}
                    </Link>
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {u.item?.name ?? "—"}
                      </p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {u.serial_number}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[u.status]}>
                      {STATUS_LABEL[u.status]}
                    </Badge>
                    <span className="truncate text-xs text-muted-foreground">
                      {u.current_cell?.name ?? "—"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {u.next_calibration_at
                        ? formatCompanyDate(u.next_calibration_at, prefs)
                        : "—"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {u.next_maintenance_at
                        ? formatCompanyDate(u.next_maintenance_at, prefs)
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

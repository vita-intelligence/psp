import Link from "next/link";
import { redirect } from "next/navigation";
import { Cog, Plus, Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { Button } from "@/components/ui/button";
import {
  listEquipmentDueSoon,
  listEquipmentPage,
} from "@/lib/equipment/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { formatCompanyDate } from "@/lib/format/company";
import { EquipmentTable } from "./equipment-table";

export const metadata = { title: "Equipment · PSP" };
export const dynamic = "force-dynamic";

export default async function EquipmentLedgerPage() {
  const user = await requireUser();
  if (!hasPermission(user, "equipment.view")) {
    redirect("/");
  }

  const [initialPage, dueSoon, prefs] = await Promise.all([
    listEquipmentPage(),
    listEquipmentDueSoon(14),
    getCompanyDefaults(),
  ]);

  const dueRows = dueSoon?.rows ?? [];
  const overdueCount = dueRows.filter((r) => r.days_until < 0).length;

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-7xl space-y-6">
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
                <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Due within 14 days
                </h2>
                <span className="ml-auto text-xs text-amber-900 dark:text-amber-200">
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
                      className="font-mono font-semibold text-amber-900 hover:underline dark:text-amber-200"
                    >
                      {row.equipment.code ?? `#${row.equipment.id}`}
                    </Link>
                    <span className="text-amber-900/80 dark:text-amber-200/80">
                      {row.equipment.item?.name ?? "—"}
                    </span>
                    <span className="rounded bg-amber-500/20 px-1.5 text-[10px] font-medium uppercase tracking-wider text-amber-900 dark:text-amber-200">
                      {row.due_kind}
                    </span>
                    <span className="ml-auto font-mono text-amber-900 dark:text-amber-200">
                      {row.days_until < 0
                        ? `${Math.abs(row.days_until)} day(s) overdue`
                        : `in ${row.days_until} day(s)`}{" "}
                      · {prefs ? formatCompanyDate(row.due_at, prefs) : row.due_at}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <EquipmentTable
            initialPage={initialPage ?? { items: [], next_cursor: null }}
          />
        </div>
      </main>
    </div>
  );
}

import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { PageHeader } from "@/components/layout/page-header";
import {
  listAllShifts,
  listHREmployeesFirstPage,
} from "@/lib/hr/server";
import { EmployeeFilter } from "../_components/employee-filter";
import { ShiftsInfiniteList } from "./shifts-infinite-list";

export const metadata = { title: "Shifts · HR · PSP" };
export const dynamic = "force-dynamic";

export default async function HRShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ employee_uuid?: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "hr.view")) redirect("/");

  const { employee_uuid } = await searchParams;
  const employeeUuid = employee_uuid?.trim() || null;

  const [page, employeesPage] = await Promise.all([
    listAllShifts({ limit: 50, employee_uuid: employeeUuid }),
    listHREmployeesFirstPage(),
  ]);

  const employees = employeesPage?.items ?? [];
  const running = page.items.filter((s) => s.ended_at === null).length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarDays}
        title="Shifts"
        description="Kiosk clock-in / clock-out windows synced from vita-performance. Newest first, infinite scroll."
      />

      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold tracking-tight">
              {employeeUuid ? "Filtered shifts" : "All shifts"}
            </h2>
            {running > 0 && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                {running} running
              </span>
            )}
          </div>
          <EmployeeFilter employees={employees} selected={employeeUuid} />
        </header>

        <ShiftsInfiniteList
          key={employeeUuid ?? "all"}
          initialItems={page.items}
          initialCursor={page.next_cursor}
          employeeUuid={employeeUuid}
        />
      </section>
    </div>
  );
}

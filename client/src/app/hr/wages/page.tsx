import { redirect } from "next/navigation";
import { Coins } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { PageHeader } from "@/components/layout/page-header";
import {
  listAllWages,
  listHREmployeesFirstPage,
} from "@/lib/hr/server";
import { EmployeeFilter } from "../_components/employee-filter";
import { WagesInfiniteList } from "./wages-infinite-list";

export const metadata = { title: "Wages · HR · PSP" };
export const dynamic = "force-dynamic";

export default async function HRWagesPage({
  searchParams,
}: {
  searchParams: Promise<{ employee_uuid?: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "hr.view")) redirect("/");

  const { employee_uuid } = await searchParams;
  const employeeUuid = employee_uuid?.trim() || null;

  const [page, employeesPage] = await Promise.all([
    listAllWages({ limit: 50, employee_uuid: employeeUuid }),
    listHREmployeesFirstPage(),
  ]);

  const employees = employeesPage?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Coins}
        title="Wages"
        description="Company-wide wage timeline. Every rate change writes a new row; the one with no end date is currently in effect. The MO cost breakdown reads the row that was open on the session's start time."
      />

      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">
            {employeeUuid ? "Filtered wages" : "All wages"}
          </h2>
          <EmployeeFilter employees={employees} selected={employeeUuid} />
        </header>

        <WagesInfiniteList
          key={employeeUuid ?? "all"}
          initialItems={page.items}
          initialCursor={page.next_cursor}
          employeeUuid={employeeUuid}
        />
      </section>
    </div>
  );
}

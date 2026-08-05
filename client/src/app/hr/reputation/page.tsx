import { redirect } from "next/navigation";
import { Award } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { PageHeader } from "@/components/layout/page-header";
import {
  listAllReputationEvents,
  listHREmployeesFirstPage,
} from "@/lib/hr/server";
import { EmployeeFilter } from "../_components/employee-filter";
import { ReputationInfiniteList } from "./reputation-infinite-list";

export const metadata = { title: "Reputation · HR · PSP" };
export const dynamic = "force-dynamic";

export default async function HRReputationPage({
  searchParams,
}: {
  searchParams: Promise<{ employee_uuid?: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "hr.view")) redirect("/");

  const { employee_uuid } = await searchParams;
  const employeeUuid = employee_uuid?.trim() || null;

  const [page, employeesPage] = await Promise.all([
    listAllReputationEvents({ limit: 50, employee_uuid: employeeUuid }),
    listHREmployeesFirstPage(),
  ]);

  const employees = employeesPage?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Award}
        title="Reputation"
        description="Company-wide reputation event log. Cached score is a projection: 650 baseline ± Σ(delta × linear decay over 180d), clamped to [300, 850]."
      />

      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">
            {employeeUuid ? "Filtered events" : "All events"}
          </h2>
          <EmployeeFilter employees={employees} selected={employeeUuid} />
        </header>

        <ReputationInfiniteList
          key={employeeUuid ?? "all"}
          initialItems={page.items}
          initialCursor={page.next_cursor}
          employeeUuid={employeeUuid}
        />
      </section>
    </div>
  );
}

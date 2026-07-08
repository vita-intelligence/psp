import { notFound, redirect } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { PageHeader } from "@/components/layout/page-header";
import { getHREmployee, listHREmployeeWages } from "@/lib/hr/server";
import { WagesInfiniteList } from "./wages-infinite-list";

export const metadata = { title: "Wage history · HR · PSP" };
export const dynamic = "force-dynamic";

/**
 * Dedicated infinite-scroll page for one employee's wage history.
 * Sidebar caps at 5 wages; this page walks the cursor at 50/page.
 */
export default async function EmployeeWagesPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "hr.view")) redirect("/");

  const { uuid } = await params;
  const [employee, firstPage] = await Promise.all([
    getHREmployee(uuid),
    listHREmployeeWages(uuid, { limit: 50 }),
  ]);
  if (!employee) notFound();

  const currentSuffix = employee.current_wage
    ? ` · current ${employee.current_wage.hourly_rate} ${employee.current_wage.currency_code}/h`
    : "";

  return (
    <div className="space-y-6">
      <PageHeader
        size="detail"
        icon={TrendingUp}
        title="Wage history"
        description={
          <>
            {employee.full_name}
            {currentSuffix}
          </>
        }
        backHref={`/hr/employees/${employee.uuid}`}
        backLabel="Back to profile"
      />
      <section className="rounded-lg border border-border/60 bg-card p-6 shadow-sm">
        <WagesInfiniteList
          employeeUuid={employee.uuid}
          initialItems={firstPage.items}
          initialCursor={firstPage.next_cursor}
        />
      </section>
    </div>
  );
}

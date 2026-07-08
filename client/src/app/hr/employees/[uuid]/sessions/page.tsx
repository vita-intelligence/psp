import { notFound, redirect } from "next/navigation";
import { Activity } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { PageHeader } from "@/components/layout/page-header";
import { getHREmployee, listHREmployeeSessions } from "@/lib/hr/server";
import { SessionsInfiniteList } from "./sessions-infinite-list";

export const metadata = { title: "Sessions · HR · PSP" };
export const dynamic = "force-dynamic";

/**
 * Dedicated infinite-scroll page for one employee's workstation
 * sessions. Sidebar caps at 5; this page walks the cursor at 50/page.
 */
export default async function EmployeeSessionsPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "hr.view")) redirect("/");

  const { uuid } = await params;
  const [employee, firstPage] = await Promise.all([
    getHREmployee(uuid),
    listHREmployeeSessions(uuid, { limit: 50 }),
  ]);
  if (!employee) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        size="detail"
        icon={Activity}
        title="Workstation sessions"
        description={
          <>
            {employee.full_name} · every clock-in across production, cleaning,
            maintenance, and off-MO activity
          </>
        }
        backHref={`/hr/employees/${employee.uuid}`}
        backLabel="Back to profile"
      />
      <SessionsInfiniteList
        employeeUuid={employee.uuid}
        initialItems={firstPage.items}
        initialCursor={firstPage.next_cursor}
      />
    </div>
  );
}

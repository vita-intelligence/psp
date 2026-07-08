import { notFound, redirect } from "next/navigation";
import { Award } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { PageHeader } from "@/components/layout/page-header";
import {
  getHREmployee,
  listHREmployeeReputationEvents,
} from "@/lib/hr/server";
import { ReputationEventsInfiniteList } from "./reputation-events-infinite-list";

export const metadata = { title: "Reputation events · HR · PSP" };
export const dynamic = "force-dynamic";

/**
 * Dedicated infinite-scroll page for one employee's reputation events.
 *
 * The profile sidebar caps at 5 events with a "View all →" link
 * pointing here — this page walks the keyset cursor at 50 per page.
 * Necessary because prolific workers accumulate 700+ events on the
 * WorkerReputationEvent stream; rendering them inline made the profile
 * page unusable. Sits inside the shared `/hr` layout so the HRSubnav
 * still renders above.
 */
export default async function EmployeeReputationPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "hr.view")) redirect("/");

  const { uuid } = await params;
  const [employee, firstPage] = await Promise.all([
    getHREmployee(uuid),
    listHREmployeeReputationEvents(uuid, { limit: 50 }),
  ]);
  if (!employee) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        size="detail"
        icon={Award}
        title="Reputation events"
        description={
          <>
            {employee.full_name} ·{" "}
            <span className="font-mono">{employee.reputation_score}</span>{" "}
            reputation
          </>
        }
        backHref={`/hr/employees/${employee.uuid}`}
        backLabel="Back to profile"
      />
      <section className="rounded-lg border border-border/60 bg-card p-6 shadow-sm">
        <ReputationEventsInfiniteList
          employeeUuid={employee.uuid}
          initialItems={firstPage.items}
          initialCursor={firstPage.next_cursor}
        />
      </section>
    </div>
  );
}

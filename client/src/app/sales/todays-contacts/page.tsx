import { redirect } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { getTodayBuckets } from "@/lib/today/server";
import { SalesSubnav } from "../sales-subnav";
import { TodaysContactsBoard } from "./todays-contacts-board";

export const metadata = { title: "Today's contacts · Sales · PSP" };

export default async function TodaysContactsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "customers.view")) {
    redirect("/settings/profile");
  }

  const [buckets, company] = await Promise.all([
    getTodayBuckets(),
    getCompanyDefaults(),
  ]);

  const canEdit = hasPermission(user, "customers.edit");

  const dueCount = buckets?.due_today.length ?? 0;
  const overdueCount = buckets?.overdue.length ?? 0;
  const quietCount = buckets?.going_quiet.length ?? 0;
  const total = dueCount + overdueCount + quietCount;

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={CalendarClock}
            title={<>Today&rsquo;s contacts</>}
            description={
              <>
                The daily CRM follow-up surface. Three buckets — due today,
                overdue, and going quiet — pulled live from the customer
                cadence. Log a call to advance the cadence, or snooze when
                the customer asked you to call back later.
                {total > 0 && (
                  <>
                    {" "}
                    <strong className="text-foreground">{total}</strong> on the
                    list right now.
                  </>
                )}
              </>
            }
          />

          <TodaysContactsBoard
            initial={
              buckets ?? { due_today: [], overdue: [], going_quiet: [] }
            }
            canEdit={canEdit}
            prefs={company ?? null}
          />
        </div>
      </main>
    </div>
  );
}

import { redirect } from "next/navigation";
import { ListChecks } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageHeader } from "@/components/layout/page-header";
import { getCompanyDefaults } from "@/lib/company/server";
import { listMyTasks } from "@/lib/my-tasks/server";
import { MyTasksBoard } from "./my-tasks-board";

export const metadata = { title: "My tasks · PSP" };
export const dynamic = "force-dynamic";

export default async function MyTasksPage() {
  const user = await requireUser();
  // No dedicated view perm — every authenticated operator sees their
  // own tasks. The server-side filter already respects each action's
  // gate, so an operator with zero permissions gets an empty list.
  if (!user) redirect("/login?next=%2Fmy-tasks");

  // First page only — the client fetches additional pages + filters
  // through the same endpoint. Bigger initial page (100) keeps most
  // sessions on a single round-trip while still capping the payload.
  const [initialPage, defaults] = await Promise.all([
    listMyTasks({ limit: 100 }),
    getCompanyDefaults(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-4xl space-y-6">
          <PageHeader
            icon={ListChecks}
            title="My tasks"
            description="Every project step you personally can act on — filtered by your permissions and the segregation-of-duties rules (e.g. you can't sign both tiers of the same order)."
          />

          <MyTasksBoard initialPage={initialPage} companyDefaults={defaults} />
        </div>
      </main>
    </div>
  );
}

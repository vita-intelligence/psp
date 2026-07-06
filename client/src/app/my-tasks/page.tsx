import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { listMyTasks } from "@/lib/my-tasks/server";
import { MyTasksBoard } from "./my-tasks-board";

export const metadata = { title: "My tasks · PSP" };
export const dynamic = "force-dynamic";

export default async function MyTasksPage() {
  const user = await requireUser();
  if (!user) redirect("/login?next=%2Fmy-tasks");

  const [initialPage, defaults] = await Promise.all([
    listMyTasks({ limit: 100 }),
    getCompanyDefaults(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <MyTasksBoard initialPage={initialPage} companyDefaults={defaults} />
        </div>
      </main>
    </div>
  );
}

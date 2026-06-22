import { redirect } from "next/navigation";
import { Play } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getProductionRunQueue } from "@/lib/production-run/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { ProductionSubnav } from "../production-subnav";
import { ProductionRunsList } from "./production-runs-list";

export const metadata = { title: "Production runs · Production · PSP" };

/**
 * Desktop landing for the production-floor operator. Lists MOs that
 * are preflight-cleared and either ready-to-start or actively
 * in_progress. Active runs sort to the top so the supervisor sees
 * the live shop floor first.
 */
export default async function ProductionRunsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.mo_execute")) {
    redirect("/production");
  }

  const [queue, company] = await Promise.all([
    getProductionRunQueue(),
    getCompanyDefaults(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              <Play className="size-7 text-brand sm:size-8" />
              Production runs
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
              Start and finish MOs on the floor. Tap a row to open its
              run page; Finish captures the actual times + produced
              quantity and auto-creates the output stock lot at the
              production-feed cell.
            </p>
          </header>

          <ProductionRunsList
            initialQueue={queue?.items ?? []}
            companyDateFormat={company}
          />
        </div>
      </main>
    </div>
  );
}

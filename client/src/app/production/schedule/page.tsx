import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listProductionFacilitiesFirstPage } from "@/lib/warehouses/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { ProductionSubnav } from "../production-subnav";
import { ScheduleWorkspace } from "./schedule-workspace";

export const metadata = {
  title: "Production schedule · Production · PSP",
};

export const dynamic = "force-dynamic";

export default async function ProductionSchedulePage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.mo_view")) {
    redirect("/settings/profile");
  }

  const canEditSteps = hasPermission(user, "production.mo_edit");
  const canRelease = hasPermission(user, "production.mo_release");
  const [facilities, company] = await Promise.all([
    listProductionFacilitiesFirstPage(50),
    getCompanyDefaults(),
  ]);
  const sites = facilities.items.map((w) => ({
    id: w.id,
    uuid: w.uuid,
    name: w.name,
  }));

  if (!company) {
    redirect("/settings/profile");
  }

  // Fullscreen calendar — TopBar + subnav sit at the top, then the
  // workspace absorbs every remaining pixel so the calendar feels
  // like a planning app, not a section of a marketing page.
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border/60 bg-card px-4 py-2 sm:px-6">
          <CalendarDays className="size-5 text-brand" />
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight">
              Production schedule
            </h1>
            <p className="truncate text-[11px] text-muted-foreground">
              Drag from the backlog onto the calendar to schedule. Drag
              a placed block to move it.
            </p>
          </div>
        </header>

        {sites.length === 0 ? (
          <p className="m-6 rounded-md border border-border/60 bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
            No production sites yet. Create one from Settings →
            Production sites first.
          </p>
        ) : (
          <ScheduleWorkspace
            sites={sites}
            canEditSteps={canEditSteps}
            canRelease={canRelease}
            company={company}
          />
        )}
      </main>
    </div>
  );
}

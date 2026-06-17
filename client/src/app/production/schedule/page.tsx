import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listProductionFacilitiesFirstPage } from "@/lib/warehouses/server";
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
  const facilities = await listProductionFacilitiesFirstPage(50);
  const sites = facilities.items.map((w) => ({
    id: w.id,
    uuid: w.uuid,
    name: w.name,
  }));

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-[110rem] space-y-6">
          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              <CalendarDays className="size-7 text-brand sm:size-8" />
              Production schedule
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
              Approved + in-progress operations laid out by workstation
              group. Working hours and holidays follow the chain
              company → site → workstation group. Drag a block to
              reschedule.
            </p>
          </header>

          {sites.length === 0 ? (
            <p className="rounded-md border border-border/60 bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
              No production sites yet. Create one from Settings →
              Production sites first.
            </p>
          ) : (
            <ScheduleWorkspace sites={sites} canEditSteps={canEditSteps} />
          )}
        </div>
      </main>
    </div>
  );
}

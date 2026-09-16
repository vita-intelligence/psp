import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Cog } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { CommentThread } from "@/components/comments/comment-thread";
import { listCommentsForEntity } from "@/lib/comments/server";
import {
  getEquipment,
  listEquipmentEvents,
  listEquipmentFiles,
  listEquipmentMaintenanceTasks,
  listEquipmentRepairs,
  listEquipmentRunningCostComponents,
} from "@/lib/equipment/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { EquipmentDetail } from "./equipment-detail";
import { EquipmentEventTimeline } from "./equipment-event-timeline";
import { EquipmentFilesCard } from "./equipment-files-card";
import { EquipmentMaintenanceTasksCard } from "./equipment-maintenance-tasks-card";
import { EquipmentRepairsCard } from "./equipment-repairs-card";
import { EquipmentRunningCostCard } from "./equipment-running-cost-card";

export const metadata = { title: "Equipment · PSP" };
export const dynamic = "force-dynamic";

export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "equipment.view")) {
    redirect("/");
  }

  const { uuid } = await params;
  const [unit, prefs, events, files, tasks, repairs, comments, runningCosts] =
    await Promise.all([
      getEquipment(uuid),
      getCompanyDefaults(),
      listEquipmentEvents(uuid),
      listEquipmentFiles(uuid),
      listEquipmentMaintenanceTasks(uuid),
      listEquipmentRepairs(uuid),
      listCommentsForEntity("equipment", uuid),
      listEquipmentRunningCostComponents(uuid),
    ]);

  if (!unit) notFound();
  if (!prefs) notFound();

  const canAct = hasPermission(user, "equipment.act");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-4xl space-y-6">
          <PageHeader
            icon={Cog}
            title={
              unit.item?.uuid ? (
                <Link
                  href={`/production/items/${unit.item.uuid}`}
                  className="underline-offset-2 hover:underline"
                >
                  {unit.item.name}
                </Link>
              ) : (
                unit.item?.name ?? "Equipment"
              )
            }
            description={`${unit.code ?? `#${unit.id}`} · Serial ${unit.serial_number}`}
            backHref="/equipment"
          />

          <EquipmentDetail equipment={unit} canAct={canAct} prefs={prefs} />

          <EquipmentRunningCostCard
            equipmentUuid={unit.uuid}
            components={runningCosts.items}
            hourlyRunningCost={runningCosts.hourly_running_cost}
            hourlyRunningCostCurrency={runningCosts.hourly_running_cost_currency}
            workstation={unit.workstation}
            canEdit={canAct}
            prefs={prefs}
            defaultCurrency={unit.currency ?? prefs.currency_code}
          />

          <EquipmentMaintenanceTasksCard
            equipmentUuid={unit.uuid}
            tasks={tasks}
            canEdit={canAct}
            prefs={prefs}
          />

          <EquipmentRepairsCard
            equipmentUuid={unit.uuid}
            repairs={repairs}
            canEdit={canAct}
            prefs={prefs}
          />

          <EquipmentEventTimeline events={events} prefs={prefs} />

          <EquipmentFilesCard
            equipmentUuid={unit.uuid}
            files={files}
            canEdit={canAct}
            prefs={prefs}
          />

          <CommentThread
            entityType="equipment"
            entityUuid={unit.uuid}
            initial={comments ?? []}
            canComment={canAct}
            currentUserId={user.id}
          />
        </div>
      </main>
    </div>
  );
}

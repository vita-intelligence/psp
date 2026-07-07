import { notFound, redirect } from "next/navigation";
import { Cog } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getEquipment } from "@/lib/equipment/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { EquipmentDetail } from "./equipment-detail";

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
  const [unit, prefs] = await Promise.all([
    getEquipment(uuid),
    getCompanyDefaults(),
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
            title={unit.item?.name ?? "Equipment"}
            description={`${unit.code ?? `#${unit.id}`} · Serial ${unit.serial_number}`}
            backHref="/equipment"
          />

          <EquipmentDetail equipment={unit} canAct={canAct} prefs={prefs} />
        </div>
      </main>
    </div>
  );
}

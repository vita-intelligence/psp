import { redirect } from "next/navigation";
import { Cog } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { listEquipmentCategories } from "@/lib/equipment/server";
import { listWorkstationsPage } from "@/lib/production/server";
import { NewEquipmentForm } from "./new-equipment-form";

export const metadata = { title: "New equipment · PSP" };
export const dynamic = "force-dynamic";

export default async function NewEquipmentPage() {
  const user = await requireUser();
  if (!hasPermission(user, "equipment.create")) {
    redirect("/equipment");
  }

  const categories = await listEquipmentCategories();
  const workstationsPage = await listWorkstationsPage({
    query: "is_active=true&limit=200",
  });
  const workstations = (workstationsPage?.items ?? []).map((w) => ({
    id: w.id,
    uuid: w.uuid,
    name: w.name,
    workstation_group: w.workstation_group,
  }));

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-2xl space-y-6">
          <PageHeader
            icon={Cog}
            title="New equipment"
            description="Manual entry — opening balance, donation, or one-off. Goods-in flow for PO receipts lands in a follow-up PR."
            backHref="/equipment"
          />
          <NewEquipmentForm
            categories={categories}
            workstations={workstations}
          />
        </div>
      </main>
    </div>
  );
}

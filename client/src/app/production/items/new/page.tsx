import { redirect } from "next/navigation";
import { Package } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listUnitsOfMeasurement } from "@/lib/units/server";
import {
  listActiveAttributeDefinitionsForScope,
  listProductFamiliesForPicker,
} from "@/lib/catalogs/server";
import { listAllergens } from "@/lib/allergens/server";
import { listStorageTags } from "@/lib/storage-tags/server";
import { ProductionSubnav } from "../../production-subnav";
import { ItemForm } from "../item-form";

export const metadata = { title: "New item · Production · PSP" };

export default async function NewItemPage() {
  const user = await requireUser();
  if (!hasPermission(user, "items.create")) {
    redirect("/production/items");
  }

  const [units, families, attributeDefinitions, allergens, storageTags] =
    await Promise.all([
      listUnitsOfMeasurement(),
      listProductFamiliesForPicker(),
      listActiveAttributeDefinitionsForScope("raw_material"),
      listAllergens(),
      listStorageTags(),
    ]);

  const canEditRisk = hasPermission(user, "risk_assessments.create");
  const canApproveRisk = hasPermission(user, "risk_assessments.approve");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Package}
            size="detail"
            title="New item"
            description="Identity + attributes only on create. Compliance / risk / spec / packaging sections light up after the row is saved."
            backHref="/production/items"
            backLabel="Back to items"
          />

          {/* Mega-form, new-item mode: only identity + attributes are
              available. Compliance / risk / spec / packaging sections
              light up after the row is created (they need an item_id). */}
          <ItemForm
            item={null}
            canEdit
            canEditRisk={canEditRisk}
            canApproveRisk={canApproveRisk}
            units={units ?? []}
            families={families ?? []}
            attributeDefinitions={attributeDefinitions ?? []}
            allAllergens={allergens ?? []}
            storageTags={storageTags ?? []}
          />
        </div>
      </main>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { listUnitsOfMeasurement } from "@/lib/units/server";
import {
  listActiveAttributeDefinitionsForScope,
  listProductFamiliesForPicker,
} from "@/lib/catalogs/server";
import { listAllergens } from "@/lib/allergens/server";
import { listStorageTags } from "@/lib/storage-tags/server";
import { ItemForm } from "../item-form";

export const metadata = { title: "New item · Settings · PSP" };

export default async function NewItemPage() {
  const user = await requireUser();
  if (!hasPermission(user, "items.create")) {
    redirect("/settings/items");
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
    <div className="max-w-3xl space-y-4">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
      >
        <Link href="/settings/items">
          <ChevronLeft className="mr-1 size-4" />
          Back to items
        </Link>
      </Button>

      {/* Mega-form, new-item mode: only identity + attributes are
          available. Compliance / risk / spec / packaging sections light
          up after the row is created (they need an item_id). */}
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
  );
}

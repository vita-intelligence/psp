import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listEquipmentCategories } from "@/lib/equipment/server";
import { EquipmentCategoriesEditor } from "./equipment-categories-editor";

export const metadata = {
  title: "Equipment categories · Settings · PSP",
};

export default async function EquipmentCategoriesPage() {
  const user = await requireUser();
  if (!hasPermission(user, "equipment.view")) {
    redirect("/settings/profile");
  }

  const canEdit = hasPermission(user, "equipment.act");
  const categories = await listEquipmentCategories({ includeInactive: true });

  return (
    <Card className="border-border/60">
      <CardHeader className="space-y-1.5">
        <CardTitle>Equipment categories</CardTitle>
        <CardDescription>
          Grouping labels for physical equipment — drills, mixers, forklifts,
          laptops. Defaults on a category (useful life, calibration cadence,
          maintenance cadence) auto-populate when a new equipment row is
          created, so operators don't have to re-type them per unit.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EquipmentCategoriesEditor
          initial={categories}
          canEdit={canEdit}
        />
      </CardContent>
    </Card>
  );
}

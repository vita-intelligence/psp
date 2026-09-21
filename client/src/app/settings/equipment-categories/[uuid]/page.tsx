import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Cog } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  listEquipmentCategories,
  listCategoryFormAssignments,
} from "@/lib/equipment/server";
import { listFormTemplates } from "@/lib/forms/server";
import { CategoryFormAssignmentsEditor } from "./category-form-assignments-editor";

export const metadata = {
  title: "Category · Equipment · Settings · PSP",
};

export const dynamic = "force-dynamic";

export default async function EquipmentCategoryDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "equipment.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;

  // Categories list is small — fetching it once + filtering client-
  // side is cheaper than adding a dedicated per-uuid endpoint just
  // for the header of this page.
  const [allCategories, initialAssignments, allTemplates] = await Promise.all([
    listEquipmentCategories({ includeInactive: true }),
    listCategoryFormAssignments(uuid),
    listFormTemplates(),
  ]);

  const category = allCategories.find((c) => c.uuid === uuid);
  if (!category) notFound();

  const canEdit = hasPermission(user, "equipment.act");

  // Only equipment-scoped templates are legal candidates here.
  const equipmentTemplates = (allTemplates ?? []).filter(
    (t) =>
      t.is_active &&
      (t.trigger === "equipment_cleaning" ||
        t.trigger === "equipment_maintenance"),
  );

  return (
    <div className="mx-auto w-full space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="-ml-2 h-7 gap-1 px-2"
        >
          <Link href="/settings/equipment-categories">
            <ChevronLeft className="size-3.5" aria-hidden />
            All categories
          </Link>
        </Button>
        <span aria-hidden>/</span>
        <span>{category.name}</span>
      </div>

      <div className="space-y-1.5">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Cog className="size-5 text-muted-foreground" aria-hidden />
          {category.name}
        </h1>
        {category.notes && (
          <p className="text-sm text-muted-foreground">{category.notes}</p>
        )}
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-sm">Kiosk forms</CardTitle>
          <CardDescription className="text-[12px]">
            Attach cleaning or maintenance checklists to this category —
            every equipment tagged with this category inherits them, so
            one CIP checklist covers every V-blender in the plant.
            Attach here means: when an operator scopes a cleaning /
            maintenance session on the kiosk to any machine in this
            category, these are the forms that fire.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CategoryFormAssignmentsEditor
            categoryUuid={category.uuid}
            initial={initialAssignments}
            allTemplates={equipmentTemplates}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>
    </div>
  );
}

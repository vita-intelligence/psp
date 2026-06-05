import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { getUnitOfMeasurement } from "@/lib/units/server";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import { UnitForm } from "../unit-form";

export const metadata = { title: "Edit unit · Settings · PSP" };

export default async function EditUnitPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "units.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const unit = await getUnitOfMeasurement(uuid);
  if (!unit) notFound();

  const canEdit = hasPermission(user, "units.manage");

  return (
    // max-w-3xl pins form + ownership + activity to one width so they
    // line up edge-to-edge, and gives the live-cursor coords a stable
    // anchor across every editor's viewport.
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
        >
          <Link href="/settings/units-of-measurement">
            <ChevronLeft className="mr-1 size-4" />
            Back to units
          </Link>
        </Button>
      </div>

      <UnitForm unit={unit} canEdit={canEdit} />

      <AuditMetaSection
        inserted_at={unit.inserted_at}
        updated_at={unit.updated_at}
        created_by={unit.created_by}
        updated_by={unit.updated_by}
      />
      <AuditHistoryCard
        entityType="unit_of_measurement"
        entityId={unit.id}
        canRestore={canEdit}
      />
    </div>
  );
}

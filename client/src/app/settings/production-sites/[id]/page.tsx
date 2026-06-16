import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { getProductionFacility } from "@/lib/warehouses/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft, AlertCircle } from "lucide-react";
import { EditModeToggle } from "@/components/forms/edit-mode-toggle";
import { WarehouseForm } from "../../warehouses/warehouse-form";
import { DeleteProductionSiteButton } from "./delete-production-site-button";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import {
  WarehouseTabsBar,
  type WarehouseTab,
} from "../../warehouses/[id]/warehouse-tabs-bar";
import { PlanTab } from "../../warehouses/[id]/plan-tab";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export const metadata = { title: "Production site · Settings · PSP" };

export default async function ProductionSiteEditPage({
  params,
  searchParams,
}: PageProps) {
  const user = await requireUser();
  if (!hasPermission(user, "production.facility_view")) {
    redirect("/settings/profile");
  }

  const [{ id }, { tab: rawTab }] = await Promise.all([params, searchParams]);
  const tab: WarehouseTab = rawTab === "plan" ? "plan" : "details";

  const [facility, companyDefaults] = await Promise.all([
    getProductionFacility(id),
    getCompanyDefaults(),
  ]);

  if (!facility) notFound();
  if (!companyDefaults) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/[0.02] px-4 py-10 text-center">
        <AlertCircle className="mx-auto size-8 text-destructive" />
        <p className="mt-2 text-sm font-medium text-destructive">
          Couldn&apos;t load company defaults
        </p>
      </div>
    );
  }

  const canEdit = hasPermission(user, "production.facility_edit");
  const canDelete = hasPermission(user, "production.facility_delete");

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
        >
          <Link href="/settings/production-sites">
            <ChevronLeft className="mr-1 size-4" />
            Back to production sites
          </Link>
        </Button>
        {canDelete && (
          <DeleteProductionSiteButton
            uuid={facility.uuid}
            name={facility.name}
          />
        )}
      </div>

      <WarehouseTabsBar
        active={tab}
        warehouseUuid={facility.uuid}
        basePath="/settings/production-sites"
      />

      {tab === "details" ? (
        <>
          <EditModeToggle canEdit={canEdit}>
            <WarehouseForm
              warehouse={facility}
              company={companyDefaults}
              canEdit={canEdit}
              kind="production_facility"
            />
          </EditModeToggle>
          <AuditMetaSection
            inserted_at={facility.inserted_at}
            updated_at={facility.updated_at}
            created_by={facility.created_by}
            updated_by={facility.updated_by}
          />
          <AuditHistoryCard
            entityType="warehouse"
            entityId={facility.id}
            canRestore={canEdit}
          />
        </>
      ) : (
        <PlanTab
          warehouseUuid={facility.uuid}
          warehouseId={facility.id}
          warehouseName={facility.name}
          readiness={facility.readiness}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}

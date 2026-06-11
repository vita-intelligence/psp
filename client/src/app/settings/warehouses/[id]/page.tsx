import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { getWarehouse } from "@/lib/warehouses/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft, AlertCircle } from "lucide-react";
import { WarehouseForm } from "../warehouse-form";
import { DeleteWarehouseButton } from "./delete-warehouse-button";
import { AuditMetaSection } from "@/components/audit/audit-meta-section";
import { AuditHistoryCard } from "@/components/audit/audit-history-card";
import {
  WarehouseTabsBar,
  type WarehouseTab,
} from "./warehouse-tabs-bar";
import { PlanTab } from "./plan-tab";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export const metadata = { title: "Warehouse · Settings · PSP" };

export default async function WarehouseEditPage({
  params,
  searchParams,
}: PageProps) {
  const user = await requireUser();
  if (!hasPermission(user, "warehouses.view")) {
    redirect("/settings/profile");
  }

  const [{ id }, { tab: rawTab }] = await Promise.all([params, searchParams]);
  const tab: WarehouseTab = rawTab === "plan" ? "plan" : "details";

  const [warehouse, companyDefaults] = await Promise.all([
    getWarehouse(id),
    getCompanyDefaults(),
  ]);

  if (!warehouse) notFound();
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

  const canEdit = hasPermission(user, "warehouses.edit");
  const canDelete = hasPermission(user, "warehouses.delete");

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
        >
          <Link href="/settings/warehouses">
            <ChevronLeft className="mr-1 size-4" />
            Back to warehouses
          </Link>
        </Button>
        {canDelete && (
          <DeleteWarehouseButton uuid={warehouse.uuid} name={warehouse.name} />
        )}
      </div>

      <WarehouseTabsBar active={tab} warehouseUuid={warehouse.uuid} />

      {tab === "details" ? (
        <>
          <WarehouseForm
            warehouse={warehouse}
            company={companyDefaults}
            canEdit={canEdit}
          />
          <AuditMetaSection
            inserted_at={warehouse.inserted_at}
            updated_at={warehouse.updated_at}
            created_by={warehouse.created_by}
            updated_by={warehouse.updated_by}
          />
          <AuditHistoryCard
            entityType="warehouse"
            entityId={warehouse.id}
            canRestore={canEdit}
          />
        </>
      ) : (
        <PlanTab
          warehouseUuid={warehouse.uuid}
          warehouseId={warehouse.id}
          warehouseName={warehouse.name}
          readiness={warehouse.readiness}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}

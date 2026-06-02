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

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata = { title: "Warehouse · Settings · PSP" };

export default async function WarehouseEditPage({ params }: PageProps) {
  const user = await requireUser();
  if (!hasPermission(user, "warehouses.view")) {
    redirect("/settings/profile");
  }

  const { id } = await params;
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
    <div className="space-y-4">
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
      <WarehouseForm
        warehouse={warehouse}
        company={companyDefaults}
        canEdit={canEdit}
      />
    </div>
  );
}

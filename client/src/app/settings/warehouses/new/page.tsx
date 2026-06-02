import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { getCompany } from "@/lib/company/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft, AlertCircle } from "lucide-react";
import { WarehouseForm } from "../warehouse-form";

export const metadata = { title: "New warehouse · Settings · PSP" };

export default async function NewWarehousePage() {
  const user = await requireUser();
  if (!hasPermission(user, "warehouses.create")) {
    redirect("/settings/warehouses");
  }

  const company = await getCompany();
  if (!company) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/[0.02] px-4 py-10 text-center">
        <AlertCircle className="mx-auto size-8 text-destructive" />
        <p className="mt-2 text-sm font-medium text-destructive">
          Couldn&apos;t load company defaults
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
        <Link href="/settings/warehouses">
          <ChevronLeft className="mr-1 size-4" />
          Back to warehouses
        </Link>
      </Button>
      <WarehouseForm warehouse={null} company={company} canEdit />
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { ChevronLeft, AlertCircle } from "lucide-react";
import { WarehouseForm } from "../../warehouses/warehouse-form";

export const metadata = { title: "New production site · Settings · PSP" };

export default async function NewProductionSitePage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.facility_create")) {
    redirect("/settings/production-sites");
  }

  const company = await getCompanyDefaults();
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
    <div className="max-w-3xl space-y-4">
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
      <WarehouseForm
        warehouse={null}
        company={company}
        canEdit
        kind="production_facility"
      />
    </div>
  );
}

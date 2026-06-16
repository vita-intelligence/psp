import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { listProductionFacilitiesFirstPage } from "@/lib/warehouses/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus } from "lucide-react";
import { ProductionSitesTable } from "./production-sites-table";

export const metadata = { title: "Production sites · Settings · PSP" };

export default async function ProductionSitesPage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.facility_view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listProductionFacilitiesFirstPage();
  const canCreate = hasPermission(user, "production.facility_create");

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Production sites</CardTitle>
            <CardDescription>
              Physical manufacturing facilities with their own floor
              plan and WIP storage. Workstations (in a follow-up) live
              on the floor plan alongside storage cells.
            </CardDescription>
          </div>
          {canCreate && (
            <Button asChild size="sm" className="shrink-0">
              <Link href="/settings/production-sites/new">
                <Plus className="mr-1.5 size-4" />
                New production site
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ProductionSitesTable initialPage={initialPage} />
      </CardContent>
    </Card>
  );
}

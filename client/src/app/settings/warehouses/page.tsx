import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { listWarehousesFirstPage } from "@/lib/warehouses/server";
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
import { ActiveSessionsBanner } from "./active-sessions";
import { WarehousesTable } from "./warehouses-table";

export const metadata = { title: "Warehouses · Settings · PSP" };

export default async function WarehousesPage() {
  const user = await requireUser();
  if (!hasPermission(user, "warehouses.view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listWarehousesFirstPage();
  const canCreate = hasPermission(user, "warehouses.create");

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Warehouses</CardTitle>
            <CardDescription>
              Physical stock locations. Each warehouse can override the
              company-wide timezone, working hours, and holidays.
            </CardDescription>
          </div>
          {/* Primary CTA lives in the page header, not the table
              toolbar. Toolbars carry utility controls (search/filter/
              sort); primary actions belong with the section heading
              so they don't get orphaned on narrow viewports. */}
          {canCreate && (
            <Button asChild size="sm" className="shrink-0">
              <Link href="/settings/warehouses/new">
                <Plus className="mr-1.5 size-4" />
                New warehouse
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <WarehousesTable
          initialPage={initialPage}
          currentUserId={user.id}
          beforeTable={
            <ActiveSessionsBanner
              currentUserId={user.id}
              canCreate={canCreate}
            />
          }
        />
      </CardContent>
    </Card>
  );
}

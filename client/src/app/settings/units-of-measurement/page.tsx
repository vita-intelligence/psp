import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
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
import { listUnitsOfMeasurementPage } from "@/lib/units/server";
import { UnitsTable } from "./units-table";

export const metadata = { title: "Units of measurement · Settings · PSP" };

export default async function UnitsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "units.view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listUnitsOfMeasurementPage();
  const canEdit = hasPermission(user, "units.manage");

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Units of measurement</CardTitle>
            <CardDescription>
              The global unit vocabulary used by stock and recipes. Within
              a dimension (mass, volume, count, …) every unit converts to
              the base unit via a single multiply — no graph, no
              contradictions. Per-item pack sizes (1 case = 12 bottles)
              belong on the item, not here.
            </CardDescription>
          </div>
          {canEdit && (
            <Button asChild size="sm" className="shrink-0">
              <Link href="/settings/units-of-measurement/new">
                <Plus className="mr-1.5 size-4" />
                New unit
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <UnitsTable
          initialPage={initialPage ?? { items: [], next_cursor: null }}
        />
      </CardContent>
    </Card>
  );
}

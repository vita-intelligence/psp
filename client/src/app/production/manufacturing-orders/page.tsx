import { redirect } from "next/navigation";
import Link from "next/link";
import { Factory, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listManufacturingOrdersPage } from "@/lib/production/server";
import { buildLocationFilters } from "@/lib/data-table/location-filters";
import { ProductionSubnav } from "../production-subnav";
import { ManufacturingOrdersLedger } from "./mos-ledger";

export const metadata = { title: "Manufacturing orders · Production · PSP" };

export default async function ManufacturingOrdersPage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.mo_view")) {
    redirect("/settings/profile");
  }

  const [initialPage, locationFilters] = await Promise.all([
    listManufacturingOrdersPage(),
    buildLocationFilters({ warehouse: true, productionSite: true }),
  ]);
  const canCreate = hasPermission(user, "production.mo_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Factory}
            title="Manufacturing orders"
            description="Planned production runs. Each MO ties a quantity of a finished item to a BOM + production site, then moves through draft → approved → in progress → completed."
            actions={
              canCreate && (
                <Button asChild size="sm">
                  <Link href="/production/manufacturing-orders/new">
                    <Plus className="mr-1.5 size-4" />
                    Create MO
                  </Link>
                </Button>
              )
            }
          />

          <ManufacturingOrdersLedger
            initialPage={initialPage ?? { items: [], next_cursor: null }}
            locationFilters={locationFilters}
          />
        </div>
      </main>
    </div>
  );
}

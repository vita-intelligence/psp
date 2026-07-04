import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ShoppingCart } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ActiveSessionsBanner } from "@/components/realtime/active-sessions";
import { listPurchaseOrdersPage } from "@/lib/purchase-orders/server";
import { buildLocationFilters } from "@/lib/data-table/location-filters";
import { ProcurementSubnav } from "../procurement-subnav";
import { PurchaseOrdersTable } from "./purchase-orders-table";

export const metadata = { title: "Purchase orders · Procurement · PSP" };

export default async function PurchaseOrdersPage() {
  const user = await requireUser();
  if (!hasPermission(user, "procurement.po_view")) {
    redirect("/settings/profile");
  }

  const [initialPage, locationFilters] = await Promise.all([
    listPurchaseOrdersPage().then(
      (p) => p ?? { items: [], next_cursor: null },
    ),
    buildLocationFilters({ warehouse: true, productionSite: false }),
  ]);

  const canCreate = hasPermission(user, "procurement.po_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProcurementSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={ShoppingCart}
            title="Purchase orders"
            description="Two-tier ESIGN approval. Vendor must be approved + line items must be on the vendor's approved-supplier list before a PO can be submitted."
            actions={
              canCreate && (
                <Button asChild size="sm" className="shrink-0">
                  <Link href="/procurement/purchase-orders/new">
                    <Plus className="mr-1.5 size-4" />
                    New PO
                  </Link>
                </Button>
              )
            }
          />

          <ActiveSessionsBanner
            currentUserId={user.id}
            resourcePrefix="purchase-order"
            newRoute="/procurement/purchase-orders/new"
            resourceLabel="purchase order"
            canCreate={canCreate}
          />

          <PurchaseOrdersTable
            initialPage={initialPage}
            locationFilters={locationFilters}
          />
        </div>
      </main>
    </div>
  );
}

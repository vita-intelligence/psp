import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ShoppingCart } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ActiveSessionsBanner } from "@/components/realtime/active-sessions";
import { listPurchaseOrdersPage } from "@/lib/purchase-orders/server";
import { ProcurementSubnav } from "../procurement-subnav";
import { PurchaseOrdersTable } from "./purchase-orders-table";

export const metadata = { title: "Purchase orders · Procurement · PSP" };

export default async function PurchaseOrdersPage() {
  const user = await requireUser();
  if (!hasPermission(user, "procurement.po_view")) {
    redirect("/settings/profile");
  }

  const initialPage = (await listPurchaseOrdersPage()) ?? {
    items: [],
    next_cursor: null,
  };

  const canCreate = hasPermission(user, "procurement.po_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProcurementSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                <ShoppingCart className="size-7 text-brand sm:size-8" />
                Purchase orders
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                Two-tier ESIGN approval. Vendor must be approved + line items
                must be on the vendor's approved-supplier list before a PO
                can be submitted.
              </p>
            </div>
            {canCreate && (
              <Button asChild size="sm" className="shrink-0">
                <Link href="/procurement/purchase-orders/new">
                  <Plus className="mr-1.5 size-4" />
                  New PO
                </Link>
              </Button>
            )}
          </header>

          <ActiveSessionsBanner
            currentUserId={user.id}
            resourcePrefix="purchase-order"
            newRoute="/procurement/purchase-orders/new"
            resourceLabel="purchase order"
            canCreate={canCreate}
          />

          <PurchaseOrdersTable initialPage={initialPage} />
        </div>
      </main>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ShoppingBag } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ActiveSessionsBanner } from "@/components/realtime/active-sessions";
import { listCustomerOrdersPage } from "@/lib/customer-orders/server";
import { SalesSubnav } from "../sales-subnav";
import { CustomerOrdersTable } from "./customer-orders-table";

export const metadata = { title: "Customer orders · Sales · PSP" };

export default async function CustomerOrdersPage() {
  const user = await requireUser();
  if (!hasPermission(user, "customer_orders.view")) {
    redirect("/settings/profile");
  }

  const initialPage = (await listCustomerOrdersPage()) ?? {
    items: [],
    next_cursor: null,
  };

  const canCreate = hasPermission(user, "customer_orders.create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                <ShoppingBag className="size-7 text-brand sm:size-8" />
                Customer orders
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                Sell-side order book. Two-tier ESIGN approval. Gates at
                submit time: customer must be effectively approved, items
                must be sellable to that customer, trade-credit-limit
                not breached.
              </p>
            </div>
            {canCreate && (
              <Button asChild size="sm" className="shrink-0">
                <Link href="/sales/orders/new">
                  <Plus className="mr-1.5 size-4" />
                  New order
                </Link>
              </Button>
            )}
          </header>

          <ActiveSessionsBanner
            currentUserId={user.id}
            resourcePrefix="customer-order"
            newRoute="/sales/orders/new"
            resourceLabel="customer order"
            canCreate={canCreate}
          />

          <CustomerOrdersTable initialPage={initialPage} />
        </div>
      </main>
    </div>
  );
}

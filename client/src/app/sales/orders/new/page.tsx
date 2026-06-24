import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ShoppingBag } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { listCustomersForPicker } from "@/lib/customers/server";
import { listActiveWarehousesForMobile } from "@/lib/warehouses/server";
import { SalesSubnav } from "../../sales-subnav";
import { NewCustomerOrderForm } from "./new-customer-order-form";

export const metadata = { title: "New customer order · Sales · PSP" };

export default async function NewCustomerOrderPage() {
  const user = await requireUser();
  if (!hasPermission(user, "customer_orders.create")) {
    redirect("/sales/orders");
  }

  const [company, customers, warehouses] = await Promise.all([
    getCompanyDefaults(),
    listCustomersForPicker(),
    listActiveWarehousesForMobile(),
  ]);

  if (!company) {
    redirect("/sales/orders");
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <Link href="/sales/orders">
                <ChevronLeft className="mr-1 size-4" />
                Back to orders
              </Link>
            </Button>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <ShoppingBag className="size-6 text-brand sm:size-7" />
              New customer order
            </h1>
            <p className="text-sm text-muted-foreground">
              Pick the customer + key dates first. Lines are added on the
              next screen where the pricelist lookup auto-fills the price
              per line.
            </p>
          </header>

          <NewCustomerOrderForm
            company={company}
            customers={customers ?? []}
            warehouses={warehouses}
          />
        </div>
      </main>
    </div>
  );
}

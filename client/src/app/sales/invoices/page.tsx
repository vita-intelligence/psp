import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Receipt } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ActiveSessionsBanner } from "@/components/realtime/active-sessions";
import { listCustomerInvoicesPage } from "@/lib/customer-invoices/server";
import { SalesSubnav } from "../sales-subnav";
import { InvoicesTable } from "./invoices-table";

export const metadata = { title: "Invoices · Sales · PSP" };

export default async function InvoicesPage() {
  const user = await requireUser();
  if (!hasPermission(user, "customer_invoices.view")) {
    redirect("/settings/profile");
  }

  const initialPage = (await listCustomerInvoicesPage()) ?? {
    items: [],
    next_cursor: null,
  };

  const canCreate = hasPermission(user, "customer_invoices.create");

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
                <Receipt className="size-7 text-brand sm:size-8" />
                Invoices
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                Sell-side invoicing. Generated from confirmed COs (auto-pulls
                unbilled qty) or created standalone. Multiple partial
                payments per invoice — status auto-flips on each payment.
              </p>
            </div>
            {canCreate && (
              <Button asChild size="sm" className="shrink-0">
                <Link href="/sales/invoices/new">
                  <Plus className="mr-1.5 size-4" />
                  New invoice
                </Link>
              </Button>
            )}
          </header>

          <ActiveSessionsBanner
            currentUserId={user.id}
            resourcePrefix="customer-invoice"
            newRoute="/sales/invoices/new"
            resourceLabel="invoice"
            canCreate={canCreate}
          />

          <InvoicesTable initialPage={initialPage} />
        </div>
      </main>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Receipt } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
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
          <PageHeader
            icon={Receipt}
            title="Invoices"
            description="Sell-side invoicing. Generated from confirmed COs (auto-pulls unbilled qty) or created standalone. Multiple partial payments per invoice — status auto-flips on each payment."
            actions={
              canCreate && (
                <Button asChild size="sm" className="shrink-0">
                  <Link href="/sales/invoices/new">
                    <Plus className="mr-1.5 size-4" />
                    New invoice
                  </Link>
                </Button>
              )
            }
          />

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

import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ActiveSessionsBanner } from "@/components/realtime/active-sessions";
import { listCustomersPage } from "@/lib/customers/server";
import { SalesSubnav } from "../sales-subnav";
import { CustomersTable } from "./customers-table";

export const metadata = { title: "Customers · Sales · PSP" };

export default async function CustomersPage() {
  const user = await requireUser();
  if (!hasPermission(user, "customers.view")) {
    redirect("/settings/profile");
  }

  const initialPage = (await listCustomersPage()) ?? {
    items: [],
    next_cursor: null,
  };

  const canCreate = hasPermission(user, "customers.create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Users}
            title="Customers"
            description={
              <>
                Sell-side counterparty registry. Identity, payment
                terms, account-manager assignment, and the contact log
                that drives the &ldquo;Today&rsquo;s contacts&rdquo;
                queue.
              </>
            }
            actions={
              canCreate && (
                <Button asChild size="sm" className="shrink-0">
                  <Link href="/sales/customers/new">
                    <Plus className="mr-1.5 size-4" />
                    New customer
                  </Link>
                </Button>
              )
            }
          />

          <ActiveSessionsBanner
            currentUserId={user.id}
            resourcePrefix="customer"
            newRoute="/sales/customers/new"
            resourceLabel="customer"
            canCreate={canCreate}
          />

          <CustomersTable initialPage={initialPage} />
        </div>
      </main>
    </div>
  );
}

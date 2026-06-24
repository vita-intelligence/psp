import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
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
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                <Users className="size-7 text-brand sm:size-8" />
                Customers
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                Sell-side counterparty registry. Identity, payment
                terms, account-manager assignment, and the contact log
                that drives the &ldquo;Today&rsquo;s contacts&rdquo;
                queue.
              </p>
            </div>
            {canCreate && (
              <Button asChild size="sm" className="shrink-0">
                <Link href="/sales/customers/new">
                  <Plus className="mr-1.5 size-4" />
                  New customer
                </Link>
              </Button>
            )}
          </header>

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

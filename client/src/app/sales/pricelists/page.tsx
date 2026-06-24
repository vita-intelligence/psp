import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Tags } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { ActiveSessionsBanner } from "@/components/realtime/active-sessions";
import { listPricelistsPage } from "@/lib/pricelists/server";
import { SalesSubnav } from "../sales-subnav";
import { PricelistsTable } from "./pricelists-table";

export const metadata = { title: "Pricelists · Sales · PSP" };

export default async function PricelistsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "pricelists.view")) {
    redirect("/settings/profile");
  }

  const initialPage = (await listPricelistsPage()) ?? {
    items: [],
    next_cursor: null,
  };

  const canCreate = hasPermission(user, "pricelists.create");

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
                <Tags className="size-7 text-brand sm:size-8" />
                Pricelists
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                Selling-price quotes per (pricelist × item × min-qty).
                A customer points at one pricelist; the company default
                catches every other customer. Save = live, no approval
                gate.
              </p>
            </div>
            {canCreate && (
              <Button asChild size="sm" className="shrink-0">
                <Link href="/sales/pricelists/new">
                  <Plus className="mr-1.5 size-4" />
                  New pricelist
                </Link>
              </Button>
            )}
          </header>

          <ActiveSessionsBanner
            currentUserId={user.id}
            resourcePrefix="pricelist"
            newRoute="/sales/pricelists/new"
            resourceLabel="pricelist"
            canCreate={canCreate}
          />

          <PricelistsTable initialPage={initialPage} />
        </div>
      </main>
    </div>
  );
}

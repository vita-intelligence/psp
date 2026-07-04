import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Tags } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
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
          <PageHeader
            icon={Tags}
            title="Pricelists"
            description="Selling-price quotes per (pricelist × item × min-qty). A customer points at one pricelist; the company default catches every other customer. Save = live, no approval gate."
            actions={
              canCreate && (
                <Button asChild size="sm" className="shrink-0">
                  <Link href="/sales/pricelists/new">
                    <Plus className="mr-1.5 size-4" />
                    New pricelist
                  </Link>
                </Button>
              )
            }
          />

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

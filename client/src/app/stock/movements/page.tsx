import { redirect } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listStockMovementsPage } from "@/lib/stock/server";
import { buildLocationFilters } from "@/lib/data-table/location-filters";
import { StockSubnav } from "../stock-subnav";
import { MovementsTable } from "./movements-table";

export const metadata = { title: "Movements · Stock · PSP" };

export default async function StockMovementsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "stock.view")) {
    redirect("/settings/profile");
  }

  const [initialPage, locationFilters] = await Promise.all([
    listStockMovementsPage(),
    buildLocationFilters({ warehouse: true, productionSite: false }),
  ]);
  const seededPage = initialPage ?? { items: [], next_cursor: null };

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <StockSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto w-full space-y-6">
          <PageHeader
            icon={ArrowLeftRight}
            title="Movements"
            description="Every qty change on every lot, chronologically. Filter by date range, movement kind, or reason category to answer audit questions in one query — 'show me every damage write-off in Q3' becomes a filter, not a text grep."
          />

          <MovementsTable
            initialPage={seededPage}
            locationFilters={locationFilters}
          />
        </div>
      </main>
    </div>
  );
}

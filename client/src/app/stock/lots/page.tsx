import { redirect } from "next/navigation";
import { Layers } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listStockLotsPage } from "@/lib/stock/server";
import { listItemsForPicker } from "@/lib/items/server";
import { buildLocationFilters } from "@/lib/data-table/location-filters";
import { StockSubnav } from "../stock-subnav";
import { LotsTable } from "./lots-table";

export const metadata = { title: "Stock lots · PSP" };

interface PageProps {
  searchParams?: Promise<{ item_id?: string }>;
}

export default async function StockLotsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  if (!hasPermission(user, "stock.view")) {
    redirect("/settings/profile");
  }

  // Deep-link filter: callers (parts table, schedule banner, etc.) link
  // here with `?item_id=N` to pre-filter the lot list to a single item.
  // We carry the filter through both the SSR fetch (so the first page
  // matches) AND the client fetcher (so subsequent pages stay scoped).
  const sp = (await searchParams) ?? {};
  const itemIdParam = sp.item_id ? Number.parseInt(sp.item_id, 10) : NaN;
  const itemFilterId =
    Number.isFinite(itemIdParam) && itemIdParam > 0 ? itemIdParam : null;

  const [initialPage, locationFilters, items] = await Promise.all([
    listStockLotsPage(
      itemFilterId !== null ? { item_id: itemFilterId } : {},
    ),
    buildLocationFilters({ warehouse: true, productionSite: false }),
    itemFilterId !== null ? listItemsForPicker() : Promise.resolve([]),
  ]);
  const seededPage = initialPage ?? { items: [], next_cursor: null };
  const filteredItem =
    itemFilterId !== null
      ? items.find((i) => i.id === itemFilterId) ?? null
      : null;

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <StockSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Layers}
            title="Stock lots"
            description="Every receipt is its own immutable lot — supplier batch, expiry, CoA, cost. Click a row to see placements and the movement history."
          />

          <LotsTable
            initialPage={seededPage}
            locationFilters={locationFilters}
            canReceive={hasPermission(user, "stock.receive")}
            itemFilter={
              itemFilterId !== null
                ? {
                    id: itemFilterId,
                    name: filteredItem?.name ?? null,
                    code: filteredItem?.code ?? null,
                  }
                : null
            }
          />
        </div>
      </main>
    </div>
  );
}

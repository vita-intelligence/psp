import { redirect } from "next/navigation";
import { Boxes } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import {
  listInventoryFirstPage,
  listWarehousesForReceive,
} from "@/lib/stock/server";
import { StockSubnav } from "../stock-subnav";
import { InventoryTable } from "./inventory-table";

export const metadata = { title: "Inventory · Stock · PSP" };

export default async function StockInventoryPage() {
  const user = await requireUser();
  if (!hasPermission(user, "stock.view")) {
    redirect("/settings/profile");
  }

  const [initialPage, warehouses] = await Promise.all([
    listInventoryFirstPage(),
    listWarehousesForReceive(),
  ]);
  const seededPage = initialPage ?? { items: [], next_cursor: null };

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <StockSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Boxes}
            title="Inventory"
            description="One row per item with on-hand qty + cost value rolled up across every lot and shelf. Click a row to see its lots."
          />

          <InventoryTable initialPage={seededPage} warehouses={warehouses} />
        </div>
      </main>
    </div>
  );
}

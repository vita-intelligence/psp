import { redirect } from "next/navigation";
import { Boxes } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
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
          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              <Boxes className="size-7 text-brand sm:size-8" />
              Inventory
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
              One row per item with on-hand qty + cost value rolled up
              across every lot and shelf. Click a row to see its lots.
            </p>
          </header>

          <InventoryTable initialPage={seededPage} warehouses={warehouses} />
        </div>
      </main>
    </div>
  );
}

import { redirect } from "next/navigation";
import { Layers } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listStockLotsPage } from "@/lib/stock/server";
import { StockSubnav } from "../stock-subnav";
import { LotsTable } from "./lots-table";

export const metadata = { title: "Stock lots · PSP" };

export default async function StockLotsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "stock.view")) {
    redirect("/settings/profile");
  }

  const initialPage = (await listStockLotsPage()) ?? {
    items: [],
    next_cursor: null,
  };

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <StockSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              <Layers className="size-7 text-brand sm:size-8" />
              Stock lots
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
              Every receipt is its own immutable lot — supplier batch,
              expiry, CoA, cost. Click a row to see placements and the
              movement history.
            </p>
          </header>

          <LotsTable
            initialPage={initialPage}
            canReceive={hasPermission(user, "stock.receive")}
          />
        </div>
      </main>
    </div>
  );
}

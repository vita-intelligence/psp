import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FilePlus } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import {
  listItemsForReceive,
  listWarehousesForReceive,
} from "@/lib/stock/server";
import { StockSubnav } from "../../stock-subnav";
import { ReceiveForm } from "./receive-form";

export const metadata = { title: "Create manual lot · PSP" };

export default async function ReceiveLotPage() {
  const user = await requireUser();
  if (!hasPermission(user, "stock.receive")) {
    redirect("/stock/lots");
  }

  const [items, warehouses] = await Promise.all([
    listItemsForReceive(),
    listWarehousesForReceive(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <StockSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-4xl space-y-6">
          <Link
            href="/stock/lots"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back to stock lots
          </Link>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              <FilePlus className="size-7 text-brand sm:size-8" />
              Create manual lot
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
              For ad-hoc entries — opening balances, adjustments,
              anything that didn&apos;t come through a Purchase Order.
              Real PO receives will land here from the Procurement
              module once it ships. Source is recorded as{" "}
              <span className="font-mono">manual</span>, with your name
              + timestamp on the audit trail.
            </p>
          </header>

          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
              <p className="font-medium">No items in the catalogue yet.</p>
              <p className="mt-1 text-xs">
                Add at least one item at{" "}
                <Link
                  href="/settings/items"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Settings → Items
                </Link>{" "}
                before you can receive a lot.
              </p>
            </div>
          ) : (
            <ReceiveForm items={items} warehouses={warehouses} />
          )}
        </div>
      </main>
    </div>
  );
}

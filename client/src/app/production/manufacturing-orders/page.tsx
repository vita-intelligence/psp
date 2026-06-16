import { redirect } from "next/navigation";
import Link from "next/link";
import { Factory, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listManufacturingOrdersPage } from "@/lib/production/server";
import { ProductionSubnav } from "../production-subnav";
import { ManufacturingOrdersLedger } from "./mos-ledger";

export const metadata = { title: "Manufacturing orders · Production · PSP" };

export default async function ManufacturingOrdersPage() {
  const user = await requireUser();
  if (!hasPermission(user, "production.mo_view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listManufacturingOrdersPage();
  const canCreate = hasPermission(user, "production.mo_create");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProductionSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                <Factory className="size-7 text-brand sm:size-8" />
                Manufacturing orders
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                Planned production runs. Each MO ties a quantity of a
                finished item to a BOM + production site, then moves
                through draft → approved → in progress → completed.
              </p>
            </div>
            {canCreate && (
              <Button asChild size="sm">
                <Link href="/production/manufacturing-orders/new">
                  <Plus className="mr-1.5 size-4" />
                  Create MO
                </Link>
              </Button>
            )}
          </header>

          <ManufacturingOrdersLedger
            initialPage={initialPage ?? { items: [], next_cursor: null }}
          />
        </div>
      </main>
    </div>
  );
}

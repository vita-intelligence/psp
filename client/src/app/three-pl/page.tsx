import { redirect } from "next/navigation";
import { Package } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { getThreePLInventory } from "@/lib/three-pl/server";
import { ThreePLInventoryTable } from "./inventory-table";

export const metadata = { title: "3PL storage · PSP" };
export const dynamic = "force-dynamic";

export default async function ThreePLInventoryPage() {
  const user = await requireUser();
  if (!hasPermission(user, "three_pl.view")) {
    redirect("/settings/profile");
  }

  const [inventory, defaults] = await Promise.all([
    getThreePLInventory(),
    getCompanyDefaults(),
  ]);

  const items = inventory?.items ?? [];
  const rate = inventory?.rate ?? null;

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Package}
            title="3PL storage"
            description="Customer-owned finished goods held under bailee custody after Positive Release (BRCGS Issue 9 § 5.6 + § 4.4 segregation). Storage billing is per m³ per day from the routing timestamp until dispatch. Physical goods sit in cells with purpose `three_pl_storage`, physically segregated from our own stock."
          />
          {rate && (
            <p className="text-xs text-muted-foreground">
              {rate.amount === null ? (
                <>
                  No storage rate configured — set one on{" "}
                  <span className="whitespace-nowrap">
                    Settings → Company → 3PL storage rate
                  </span>{" "}
                  to start billing.
                </>
              ) : (
                <>
                  Current rate:{" "}
                  <span className="font-semibold text-foreground">
                    {rate.amount} {rate.currency}/m³/day
                  </span>
                  . Change it on{" "}
                  <span className="whitespace-nowrap">
                    Settings → Company
                  </span>
                  .
                </>
              )}
            </p>
          )}

          <ThreePLInventoryTable
            items={items}
            companyDefaults={defaults}
            currency={rate?.currency ?? null}
          />
        </div>
      </main>
    </div>
  );
}

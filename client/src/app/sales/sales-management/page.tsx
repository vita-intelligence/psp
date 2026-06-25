import { redirect } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { getSalesManagementSnapshot } from "@/lib/sales-management/server";
import { SalesSubnav } from "../sales-subnav";
import { SalesManagementBoard } from "./sales-management-board";

export const metadata = { title: "Sales management · Sales · PSP" };

export default async function SalesManagementPage() {
  const user = await requireUser();
  if (!hasPermission(user, "sales_management.view")) {
    redirect("/settings/profile");
  }

  const [bundle, company] = await Promise.all([
    getSalesManagementSnapshot(),
    getCompanyDefaults(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              <TrendingUp className="size-7 text-brand sm:size-8" />
              Sales management
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
              Book-of-business by account manager. Revenue YTD,
              outstanding A/R, and pipeline value (confirmed COs
              awaiting invoice) — alongside the CO funnel and any
              unassigned customers waiting to be routed. Values shown
              in <strong>{bundle?.base_currency ?? "GBP"}</strong>.
            </p>
          </header>

          <SalesManagementBoard
            snapshot={bundle?.sales_management ?? null}
            prefs={company ?? null}
            baseCurrency={bundle?.base_currency ?? "GBP"}
          />
        </div>
      </main>
    </div>
  );
}

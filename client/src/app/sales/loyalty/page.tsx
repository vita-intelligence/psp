import { redirect } from "next/navigation";
import { Gift } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { getLoyaltyDashboard } from "@/lib/loyalty/server";
import { SalesSubnav } from "../sales-subnav";
import { LoyaltyBoard } from "./loyalty-board";

export const metadata = { title: "Loyalty · Sales · PSP" };

export default async function LoyaltyPage() {
  const user = await requireUser();
  if (!hasPermission(user, "loyalty.view")) {
    redirect("/settings/profile");
  }

  const [dashboard, company] = await Promise.all([
    getLoyaltyDashboard(),
    getCompanyDefaults(),
  ]);

  const canManage = hasPermission(user, "loyalty.programs_manage");
  const canGrant = hasPermission(user, "loyalty.credits_grant");

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <SalesSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              <Gift className="size-7 text-brand sm:size-8" />
              Loyalty
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
              Reward repeat customers. Each paid invoice rolls into the
              customer&rsquo;s YTD revenue; crossing a tier threshold
              accrues a rebate as credit, which redeems against future
              invoices. Balances and recent activity below — values in{" "}
              <strong>{dashboard?.base_currency ?? "GBP"}</strong>.
            </p>
          </header>

          <LoyaltyBoard
            dashboard={dashboard}
            prefs={company ?? null}
            canManage={canManage}
            canGrant={canGrant}
          />
        </div>
      </main>
    </div>
  );
}

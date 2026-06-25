import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { getCashFlowForecast } from "@/lib/cash-flow/server";
import { SalesSubnav } from "../sales-subnav";
import { CashFlowBoard } from "./cash-flow-board";

export const metadata = { title: "Cash flow · Sales · PSP" };

export default async function CashFlowPage() {
  const user = await requireUser();
  if (!hasPermission(user, "cash_flow.view")) {
    redirect("/settings/profile");
  }

  const [bundle, company] = await Promise.all([
    getCashFlowForecast(),
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
              <Wallet className="size-7 text-brand sm:size-8" />
              Cash flow
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
              12-week receivables + payables forecast. Inflows = A/R on
              sent invoices and projected billings from confirmed
              customer orders. Outflows = A/P on received purchase
              invoices and committed PO spend. All values are converted
              to <strong>{bundle?.base_currency ?? "GBP"}</strong> using
              the company&rsquo;s FX rates.
            </p>
          </header>

          <CashFlowBoard
            forecast={bundle?.cash_flow ?? null}
            prefs={company ?? null}
            baseCurrency={bundle?.base_currency ?? "GBP"}
          />
        </div>
      </main>
    </div>
  );
}

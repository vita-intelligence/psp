import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { getStatisticsSnapshot } from "@/lib/statistics/server";
import { SalesSubnav } from "../sales-subnav";
import { StatisticsBoard } from "./statistics-board";

export const metadata = { title: "Statistics · Sales · PSP" };

export default async function StatisticsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "statistics.view")) {
    redirect("/settings/profile");
  }

  const [bundle, company] = await Promise.all([
    getStatisticsSnapshot(),
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
              <BarChart3 className="size-7 text-brand sm:size-8" />
              Statistics
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
              Sales analytics looking back. Revenue is booked when an
              invoice is issued (sent, partially-paid, or paid);
              credit notes reduce the figure for the period they
              landed in. Values shown in{" "}
              <strong>{bundle?.base_currency ?? "GBP"}</strong>.
            </p>
          </header>

          <StatisticsBoard
            snapshot={bundle?.statistics ?? null}
            prefs={company ?? null}
            baseCurrency={bundle?.base_currency ?? "GBP"}
          />
        </div>
      </main>
    </div>
  );
}

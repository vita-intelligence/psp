import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getProcurementShortages } from "@/lib/procurement-shortages/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { ProcurementSubnav } from "../procurement-subnav";
import { ShortagesTable } from "./shortages-table";

export const metadata = { title: "Shortages · Procurement · PSP" };
export const dynamic = "force-dynamic";

export default async function ProcurementShortagesPage() {
  const user = await requireUser();
  if (!hasPermission(user, "procurement.po_create")) {
    redirect("/settings/profile");
  }

  const [data, company] = await Promise.all([
    getProcurementShortages(),
    getCompanyDefaults(),
  ]);

  const initialPage = {
    items: data?.items ?? [],
    next_cursor: data?.next_cursor ?? null,
  };

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProcurementSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              <FileText className="size-7 text-brand sm:size-8" />
              Shortages
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
              Every raw-material and packaging item still short across
              open manufacturing orders, after subtracting existing
              bookings and qty already on open POs. Sort by any column,
              filter by item type or PO status, search by item name.
            </p>
          </header>

          <ShortagesTable
            initialPage={initialPage}
            companyDateFormat={company}
          />
        </div>
      </main>
    </div>
  );
}

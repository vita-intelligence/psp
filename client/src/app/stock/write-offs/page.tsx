import { redirect } from "next/navigation";
import { PackageMinus } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listStockWriteOffsPage } from "@/lib/stock/server";
import { StockSubnav } from "../stock-subnav";
import { WriteOffsTable } from "./write-offs-table";

export const metadata = { title: "Write-offs · Stock · PSP" };

export default async function StockWriteOffsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "stock.view")) {
    redirect("/settings/profile");
  }

  const initialPage = await listStockWriteOffsPage();
  const seededPage = initialPage ?? { items: [], next_cursor: null };

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <StockSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto w-full space-y-6">
          <PageHeader
            icon={PackageMinus}
            title="Write-offs"
            description="Formal three-signature paperwork wrapping every stock write-off. The actual qty change only fires when the authoriser signs — creator + approver + authoriser must be different people (BRCGS §3.11). Undoable while active; a reverted write-off restores the qty and keeps the row for the audit chain."
          />

          <WriteOffsTable
            initialPage={seededPage}
            canCreate={hasPermission(user, "stock.writeoff.file")}
          />
        </div>
      </main>
    </div>
  );
}

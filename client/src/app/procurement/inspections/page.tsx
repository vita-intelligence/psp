import { redirect } from "next/navigation";
import { Microscope } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { listInspectionsPage } from "@/lib/inspections/server";
import { listWarehousesForReceive } from "@/lib/stock/server";
import { ProcurementSubnav } from "../procurement-subnav";
import { InspectionsLedger } from "./inspections-ledger";

export const metadata = { title: "Inspections · Procurement · PSP" };

export default async function ProcurementInspectionsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "goods_in.view")) {
    redirect("/settings/profile");
  }

  const [initialPage, warehouses] = await Promise.all([
    listInspectionsPage(),
    listWarehousesForReceive(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />
      <ProcurementSubnav />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Microscope}
            title="Goods-in inspections"
            description="BRCGS / FSSC 22000 incoming-goods inspection ledger. Every approved delivery clears QC through here before its lots leave quarantine."
          />

          <InspectionsLedger
            initialPage={
              initialPage ?? {
                items: [],
                next_cursor: null,
              }
            }
            warehouses={warehouses}
          />
        </div>
      </main>
    </div>
  );
}

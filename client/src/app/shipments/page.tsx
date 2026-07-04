import { redirect } from "next/navigation";
import { Truck } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PageHeader } from "@/components/layout/page-header";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { getCompanyDefaults } from "@/lib/company/server";
import { listShipments } from "@/lib/shipments/server";
import { ShipmentList } from "./shipment-list";

export const metadata = { title: "Shipments · PSP" };
export const dynamic = "force-dynamic";

export default async function ShipmentsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "shipments.view")) {
    redirect("/settings/profile");
  }

  const [initial, defaults] = await Promise.all([
    listShipments(),
    getCompanyDefaults(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            icon={Truck}
            title="Shipments"
            description="Outbound-dispatch records (BRCGS Issue 9 § 5.4.6). A shipment row lives from the moment a lot lands in a dispatch cell until the truck picks it up — capturing recipient, carrier, vehicle, driver, waybill, and evidence photo in one place."
          />

          <ShipmentList
            initialPage={initial}
            companyDefaults={defaults}
          />
        </div>
      </main>
    </div>
  );
}

import { notFound, redirect } from "next/navigation";
import { Truck } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
import { PageHeader } from "@/components/layout/page-header";
import { getCompanyDefaults } from "@/lib/company/server";
import { getShipment } from "@/lib/shipments/server";
import { listCommentsForEntity } from "@/lib/comments/server";
import { ShipmentDetail } from "./shipment-detail";

export const metadata = { title: "Shipment · PSP" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ uuid: string }>;
}

export default async function ShipmentDetailPage({ params }: Props) {
  const user = await requireUser();
  if (!hasPermission(user, "shipments.view")) {
    redirect("/settings/profile");
  }

  const { uuid } = await params;
  const [shipment, defaults, comments] = await Promise.all([
    getShipment(uuid),
    getCompanyDefaults(),
    listCommentsForEntity("shipment", uuid),
  ]);

  if (!shipment) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <TopBar user={user} />
      <PresenceMount />

      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-5xl space-y-6">
          <PageHeader
            size="detail"
            icon={Truck}
            title={shipment.stock_lot?.item?.name ?? "Shipment"}
            description={
              <>
                Lot{" "}
                <span className="font-mono">
                  {shipment.stock_lot?.code ?? "—"}
                </span>{" "}
                — recipient {shipment.customer?.name ?? "—"}
              </>
            }
            backHref="/shipments"
            backLabel="Shipments"
          />

          <ShipmentDetail
            shipment={shipment}
            companyDefaults={defaults}
            initialComments={comments ?? []}
            currentUserId={user.id}
            canComment={hasPermission(user, "shipments.edit")}
            canEdit={hasPermission(user, "shipments.edit")}
            canPickup={hasPermission(user, "shipments.pickup")}
            canConfirmDelivery={hasPermission(user, "shipments.confirm_delivery")}
          />
        </div>
      </main>
    </div>
  );
}

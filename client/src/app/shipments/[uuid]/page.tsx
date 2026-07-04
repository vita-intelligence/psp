import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Truck } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/rbac";
import { TopBar } from "@/components/layout/top-bar";
import { PresenceMount } from "@/components/realtime/presence-mount";
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
  if (!hasPermission(user, "production.final_release")) {
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
          <div className="text-sm">
            <Link
              href="/shipments"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
              Shipments
            </Link>
          </div>

          <header className="space-y-1.5">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Truck className="size-6 text-brand sm:size-7" />
              {shipment.stock_lot?.item?.name ?? "Shipment"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Lot{" "}
              <span className="font-mono">
                {shipment.stock_lot?.code ?? "—"}
              </span>{" "}
              — recipient {shipment.customer?.name ?? "—"}
            </p>
          </header>

          <ShipmentDetail
            shipment={shipment}
            companyDefaults={defaults}
            initialComments={comments ?? []}
            currentUserId={user.id}
            canComment={hasPermission(user, "production.final_release")}
            canEdit={hasPermission(user, "production.final_release")}
          />
        </div>
      </main>
    </div>
  );
}

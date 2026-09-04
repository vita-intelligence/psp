import { redirect } from "next/navigation";
import { getCompanyDefaults } from "@/lib/company/server";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { getShipment } from "@/lib/shipments/server";
import { MobilePaperworkForm } from "./mobile-paperwork-form";

export const metadata = { title: "Shipment paperwork · PSP Mobile" };
export const dynamic = "force-dynamic";

/**
 * Mobile-only "fill the shipping form → Mark Ready" step. Sits
 * between the 3PL picker's move-to-bay flow and the truck-arrival
 * dispatch form.
 *
 * Reached by tapping a row on the /m/three-pl-dispatches
 * ``paperwork`` tab. Also usable directly by URL on a paired phone
 * for direct-ship draft shipments where the desk wants to review
 * the paperwork phone-side.
 */
export default async function MobileShipmentPaperworkPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  const [deviceToken, sessionToken] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  if (!deviceToken && !sessionToken) {
    redirect(
      `/login?next=%2Fm%2Fshipments%2F${encodeURIComponent(uuid)}%2Fpaperwork`,
    );
  }

  const [shipment, defaults] = await Promise.all([
    getShipment(uuid),
    getCompanyDefaults(),
  ]);
  if (!shipment) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-lg font-semibold">Shipment not found</h1>
        <p className="text-sm text-muted-foreground">
          It may have been cancelled or the link is wrong.
        </p>
      </div>
    );
  }

  return <MobilePaperworkForm shipment={shipment} prefs={defaults} />;
}

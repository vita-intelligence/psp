import { redirect } from "next/navigation";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { getShipment } from "@/lib/shipments/server";
import { MobileDispatchForm } from "./mobile-dispatch-form";

export const metadata = { title: "Dispatch checklist · PSP Mobile" };
export const dynamic = "force-dynamic";

/**
 * Mobile-only truck-arrival dispatch form. Reached by tapping the
 * banner that the mobile shell shows when the desktop broadcasts
 * `dispatch_open`, or by opening the URL directly on a paired phone.
 *
 * The form itself lives only here — the desktop cannot fill it in
 * because the workflow (photos, on-the-dock ergonomics) is truly
 * phone-first.
 */
export default async function MobileDispatchPage({
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
    redirect(`/login?next=%2Fm%2Fshipments%2F${encodeURIComponent(uuid)}%2Fdispatch`);
  }

  const shipment = await getShipment(uuid);
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

  return <MobileDispatchForm shipment={shipment} />;
}

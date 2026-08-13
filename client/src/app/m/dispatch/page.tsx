import { redirect } from "next/navigation";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { getFirstDispatchPickupPage } from "@/lib/shipments/mobile-server";
import { MobileDispatchPickupList } from "./mobile-dispatch-pickup-list";

export const metadata = { title: "Dispatch pickup · PSP Mobile" };
export const dynamic = "force-dynamic";

/**
 * Mobile dispatch pickup landing — every shipment marked ``ready``
 * by the coordinator, waiting for a truck. Cards show recipient +
 * city + lot code + qty + planned ship time; tap → routes to
 * ``/m/shipments/[uuid]/dispatch`` for the arrival checklist +
 * photo capture flow.
 *
 * Keyset-paginated on the server (partial index on ``ready`` rows)
 * so the page loads in constant time regardless of how many
 * historical shipments exist. First page ships as SSR; subsequent
 * pages fetch client-side via IntersectionObserver.
 */
export default async function MobileDispatchPage() {
  const [deviceToken, sessionToken] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  if (!deviceToken && !sessionToken) redirect("/login?next=%2Fm%2Fdispatch");

  const [initialPage, company] = await Promise.all([
    getFirstDispatchPickupPage(),
    getCompanyDefaults(),
  ]);

  return (
    <MobileDispatchPickupList initialPage={initialPage} company={company} />
  );
}

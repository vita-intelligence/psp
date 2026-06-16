import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { getMobileIncoming } from "@/lib/goods-in/server";
import { INCOMING_WINDOW_DAYS } from "@/lib/goods-in/constants";
import { listActiveWarehousesForMobile } from "@/lib/warehouses/server";
import { MobileIncomingList } from "./mobile-incoming-list";

export const metadata = { title: "Expected today · PSP Mobile" };

export const dynamic = "force-dynamic";

/**
 * Goods-in operator landing page — the moment the operator picks up
 * the tablet at the warehouse this is what they see. Server-fetches
 * the list of expected POs + the active-warehouse list so the picker
 * + cards have data on first paint; the client takes over for live
 * polling + filter chips.
 */
export default async function MobileIncomingPage() {
  // The board is reachable two ways: from a paired tablet (device
  // token cookie) OR from a signed-in admin / QC walking up to a
  // shared phone. Either auth path is fine — the proxy + API ctx
  // fall back to the session cookie when no device token is set.
  const [deviceToken, sessionToken] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  if (!deviceToken && !sessionToken) redirect("/login?next=%2Fm%2Fincoming");

  // Bulk SSR fetch — kept tight (single endpoint + warehouses) so the
  // tablet renders well under the 500ms target on the dock's iffy wifi.
  const [incoming, warehouses] = await Promise.all([
    getMobileIncoming({ days: INCOMING_WINDOW_DAYS }),
    listActiveWarehousesForMobile(),
  ]);

  return (
    <MobileIncomingList
      initialResponse={incoming}
      warehouses={warehouses.map((w) => ({
        id: w.id,
        uuid: w.uuid,
        name: w.name,
      }))}
    />
  );
}

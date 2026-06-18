import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { getPickupQueue } from "@/lib/warehouse-pickup/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { MobilePickupList } from "./mobile-pickup-list";

export const metadata = { title: "Pickup queue · PSP Mobile" };

export const dynamic = "force-dynamic";

/**
 * Mobile picker landing — chronological queue of released MOs whose
 * pickup window has opened. Sorted by pickup_by (planned_start − window)
 * so the most-urgent ingredients surface first.
 *
 * Cards show: MO code · item name · planned_start · pickup_by ·
 * head-of-picker badge if someone else has already started.
 */
export default async function MobilePickupPage() {
  const [deviceToken, sessionToken] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  if (!deviceToken && !sessionToken) redirect("/login?next=%2Fm%2Fpickup");

  const [queue, company] = await Promise.all([
    getPickupQueue(),
    getCompanyDefaults(),
  ]);

  return (
    <MobilePickupList
      initialResponse={queue}
      companyDateFormat={company}
    />
  );
}

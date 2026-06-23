import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import {
  getLooseDispatchLots,
  getReturnPickupQueue,
  getReturnPickupTrolley,
} from "@/lib/warehouse-return-pickup/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { MobileReturnPickupList } from "./mobile-return-pickup-list";

export const metadata = { title: "Return pickup · PSP Mobile" };

export const dynamic = "force-dynamic";

/**
 * Mobile return-pickup landing — MOs whose closed-out stock is
 * sitting at production-side dispatch cells, plus a "Loose" bucket
 * for orphan lots (no MO source_ref) and the worker's current
 * trolley.
 */
export default async function MobileReturnPickupPage() {
  const [deviceToken, sessionToken] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  if (!deviceToken && !sessionToken)
    redirect("/login?next=%2Fm%2Freturn-pickup");

  const [queue, loose, trolley, company] = await Promise.all([
    getReturnPickupQueue(),
    getLooseDispatchLots(),
    getReturnPickupTrolley(),
    getCompanyDefaults(),
  ]);

  return (
    <MobileReturnPickupList
      initialQueue={queue}
      initialLoose={loose}
      initialTrolley={trolley}
      companyDateFormat={company}
    />
  );
}

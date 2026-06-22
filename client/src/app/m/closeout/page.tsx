import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { getCloseoutQueue } from "@/lib/production-closeout/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { MobileCloseoutList } from "./mobile-closeout-list";

export const metadata = { title: "Closeout · PSP Mobile" };

export const dynamic = "force-dynamic";

/**
 * Mobile closeout landing — MOs the production worker still has open
 * items on (bookings to consume + produced output sitting at the
 * production-feed cell). Tapping a row opens the per-item scan flow.
 */
export default async function MobileCloseoutPage() {
  const [deviceToken, sessionToken] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  if (!deviceToken && !sessionToken) redirect("/login?next=%2Fm%2Fcloseout");

  const [queue, company] = await Promise.all([
    getCloseoutQueue(),
    getCompanyDefaults(),
  ]);

  return (
    <MobileCloseoutList
      initialResponse={queue}
      companyDateFormat={company}
    />
  );
}

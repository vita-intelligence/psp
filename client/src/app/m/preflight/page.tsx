import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { getPreflightQueue } from "@/lib/production-preflight/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { MobilePreflightList } from "./mobile-preflight-list";

export const metadata = { title: "Pre-production checks · PSP Mobile" };

export const dynamic = "force-dynamic";

/**
 * Mobile production-operator landing. Surfaces MOs whose warehouse
 * pickup is complete (lots are sitting on the production-feed cell)
 * but at least one raw-material / packaging booking hasn't been
 * physically verified yet. Tapping a card opens the per-booking
 * receipt flow.
 */
export default async function MobilePreflightPage() {
  const [deviceToken, sessionToken] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  if (!deviceToken && !sessionToken) redirect("/login?next=%2Fm%2Fpreflight");

  const [queue, company] = await Promise.all([
    getPreflightQueue(),
    getCompanyDefaults(),
  ]);

  return (
    <MobilePreflightList
      initialResponse={queue}
      companyDateFormat={company}
    />
  );
}

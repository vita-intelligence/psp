import { notFound, redirect } from "next/navigation";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { getPreflightDetail } from "@/lib/production-preflight/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { PreflightFlow } from "./preflight-flow";

export const metadata = { title: "Pre-production check · PSP Mobile" };

export const dynamic = "force-dynamic";

interface Params {
  mo_uuid: string;
}

/**
 * Per-MO preflight detail. The form is client-side (per-booking qty
 * + notes inputs); this page just SSR-fetches the initial bookings.
 */
export default async function MobilePreflightDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const [deviceToken, sessionToken] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  const { mo_uuid } = await params;
  if (!deviceToken && !sessionToken)
    redirect(`/login?next=%2Fm%2Fpreflight%2F${mo_uuid}`);

  const [detail, company] = await Promise.all([
    getPreflightDetail(mo_uuid),
    getCompanyDefaults(),
  ]);

  if (!detail) notFound();

  return (
    <PreflightFlow
      initialMo={detail.mo}
      initialBookings={detail.bookings}
      initialPreflightComplete={detail.preflight_complete}
      companyDateFormat={company}
    />
  );
}

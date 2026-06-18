import { notFound, redirect } from "next/navigation";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { getPickupDetail } from "@/lib/warehouse-pickup/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { PickupFlow } from "./pickup-flow";

export const metadata = { title: "Pickup · PSP Mobile" };

export const dynamic = "force-dynamic";

interface Params {
  mo_uuid: string;
}

/**
 * Per-MO pickup detail. The flow itself is client-side (scan loop +
 * progressive state); this page just SSR-fetches the initial detail
 * so first paint shows the bookings without an extra round-trip.
 */
export default async function MobilePickupDetailPage({
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
    redirect(`/login?next=%2Fm%2Fpickup%2F${mo_uuid}`);

  const [detail, company] = await Promise.all([
    getPickupDetail(mo_uuid),
    getCompanyDefaults(),
  ]);

  if (!detail) notFound();

  return (
    <PickupFlow
      initialMo={detail.mo}
      initialBookings={detail.bookings}
      companyDateFormat={company}
    />
  );
}

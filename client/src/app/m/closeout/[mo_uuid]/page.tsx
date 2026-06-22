import { notFound, redirect } from "next/navigation";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import {
  getCloseoutDetail,
  getDispatchCellsForMo,
} from "@/lib/production-closeout/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { CloseoutFlow } from "./closeout-flow";

export const metadata = { title: "Closeout · PSP Mobile" };

export const dynamic = "force-dynamic";

interface Params {
  mo_uuid: string;
}

export default async function MobileCloseoutDetailPage({
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
    redirect(`/login?next=%2Fm%2Fcloseout%2F${mo_uuid}`);

  const [detail, dispatchCells, company] = await Promise.all([
    getCloseoutDetail(mo_uuid),
    getDispatchCellsForMo(mo_uuid),
    getCompanyDefaults(),
  ]);

  if (!detail) notFound();

  return (
    <CloseoutFlow
      initialMo={detail.mo}
      initialBookings={detail.bookings}
      initialOutputLots={detail.output_lots}
      dispatchCells={dispatchCells?.items ?? []}
      companyDateFormat={company}
    />
  );
}

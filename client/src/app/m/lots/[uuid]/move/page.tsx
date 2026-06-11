import { notFound, redirect } from "next/navigation";
import { getDeviceToken } from "@/lib/devices/server";
import {
  getCellForScan,
  getLotForScan,
  listMoveRecommendations,
} from "@/lib/stock/mobile";
import { MoveFlow } from "./move-flow";

export const metadata = { title: "Move · PSP Mobile" };

interface Props {
  params: Promise<{ uuid: string }>;
  searchParams: Promise<{ to?: string }>;
}

export default async function MobileMovePage({ params, searchParams }: Props) {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const { uuid } = await params;
  const { to } = await searchParams;

  // `?to=<cell_uuid>` arrives from the scan-cell-first put-away
  // flow. When set, we pre-fetch the destination cell so MoveFlow
  // can skip PickStep + DirectionsStep and drop straight into
  // verify-cell-scan with the destination locked. Lot identity was
  // verified by the scanner that routed us here, so verify-lot is
  // skipped too.
  const [data, recommendations, preSetCell] = await Promise.all([
    getLotForScan(uuid),
    to ? Promise.resolve([]) : listMoveRecommendations(uuid),
    to ? getCellForScan(to) : Promise.resolve(null),
  ]);
  if (!data) notFound();

  return (
    <MoveFlow
      lot={data.lot}
      recommendations={recommendations}
      preSetDestination={preSetCell}
    />
  );
}

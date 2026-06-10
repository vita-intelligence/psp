import { notFound, redirect } from "next/navigation";
import { getDeviceToken } from "@/lib/devices/server";
import { getLotForScan, listMoveRecommendations } from "@/lib/stock/mobile";
import { MoveFlow } from "./move-flow";

export const metadata = { title: "Move · PSP Mobile" };

interface Props {
  params: Promise<{ uuid: string }>;
}

export default async function MobileMovePage({ params }: Props) {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const { uuid } = await params;
  const [data, recommendations] = await Promise.all([
    getLotForScan(uuid),
    listMoveRecommendations(uuid),
  ]);
  if (!data) notFound();

  return <MoveFlow lot={data.lot} recommendations={recommendations} />;
}

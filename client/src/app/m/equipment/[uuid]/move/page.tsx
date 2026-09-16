import { notFound, redirect } from "next/navigation";
import { getDeviceToken } from "@/lib/devices/server";
import { getEquipmentForScan } from "@/lib/equipment/mobile";
import { MoveFlow } from "./move-flow";

export const metadata = { title: "Move equipment · PSP Mobile" };

interface Props {
  params: Promise<{ uuid: string }>;
  searchParams: Promise<{ to?: string }>;
}

/**
 * Full-screen mobile move flow for an equipment unit — parallels
 * `/m/lots/[uuid]/move/`. Multi-step wizard with mode toggle,
 * cell picker, floor-plan preview, and camera-verified destination
 * scan. Auth via device token.
 *
 * `?to=<cell_uuid>` support (arriving from a scan-cell-first flow)
 * is reserved for parity with the lot flow — not wired yet since
 * equipment scans currently land on the equipment QR only.
 */
export default async function MobileEquipmentMovePage({
  params,
  searchParams,
}: Props) {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const { uuid } = await params;
  const _to = (await searchParams).to;
  const equipment = await getEquipmentForScan(uuid);
  if (!equipment) notFound();
  void _to;

  return <MoveFlow equipment={equipment} />;
}

import { redirect } from "next/navigation";
import { getDeviceToken } from "@/lib/devices/server";
import { ShipmentScanShell } from "./shipment-scan-shell";

export const metadata = { title: "Scan for shipment · PSP Mobile" };
export const dynamic = "force-dynamic";

export default async function MobileShipmentScanPage() {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");
  return <ShipmentScanShell />;
}

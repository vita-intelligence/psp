import { redirect } from "next/navigation";
import { getDeviceToken } from "@/lib/devices/server";
import { ScannerView } from "./scanner-view";

export const metadata = { title: "Scan · PSP Mobile" };

export default async function ScanPage() {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  return <ScannerView />;
}

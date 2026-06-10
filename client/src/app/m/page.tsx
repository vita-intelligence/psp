import { redirect } from "next/navigation";
import { getDeviceDisplay, getDeviceToken } from "@/lib/devices/server";
import { listPendingPutaway } from "@/lib/stock/mobile";
import { MobileHomeShell } from "./mobile-home-shell";

export const metadata = { title: "PSP Mobile" };

export default async function MobileHome() {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const display = await getDeviceDisplay();
  if (!display) redirect("/pair");

  // Bulk SSR fetch — pending put-away is small (typically a handful
  // of lots waiting on a shelf decision). Refreshes on every tap into
  // the shell so operators see the latest the moment they reopen.
  const pendingLots = await listPendingPutaway();

  return <MobileHomeShell display={display} pendingLots={pendingLots} />;
}

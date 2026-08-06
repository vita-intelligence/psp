import { redirect } from "next/navigation";
import { getDeviceDisplay, getDeviceToken } from "@/lib/devices/server";
import { getInspectionViewer } from "@/lib/goods-in/server";
import { getMobileHomeCounts } from "@/lib/mobile/server";
import { MobileHomeShell } from "./mobile-home-shell";

export const metadata = { title: "PSP Mobile" };

export default async function MobileHome() {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const display = await getDeviceDisplay();
  if (!display) redirect("/pair");

  // One slim call replaces four separate queue-list fetches. Each
  // count is a capped SELECT on the BE, so this page stays cheap
  // even when a warehouse has millions of historical lots.
  //
  // Viewer permissions still come from a separate call — the counts
  // endpoint filters by RBAC internally, but the FE also needs the
  // permission set to decide which tiles to render.
  const [viewer, homeCounts] = await Promise.all([
    getInspectionViewer(),
    getMobileHomeCounts(),
  ]);

  return (
    <MobileHomeShell
      display={display}
      viewerPermissions={viewer?.permissions ?? []}
      isAdmin={viewer?.is_admin ?? false}
      counts={homeCounts.counts}
      countCap={homeCounts.cap}
    />
  );
}

import { redirect } from "next/navigation";
import { getDeviceDisplay, getDeviceToken } from "@/lib/devices/server";
import { getInspectionViewer } from "@/lib/goods-in/server";
import { getMobileIncoming } from "@/lib/goods-in/server";
import { listPendingPutaway } from "@/lib/stock/mobile";
import { listPendingDispatches } from "@/lib/three-pl/server";
import { MobileHomeShell } from "./mobile-home-shell";

export const metadata = { title: "PSP Mobile" };

export default async function MobileHome() {
  const token = await getDeviceToken();
  if (!token) redirect("/pair");

  const display = await getDeviceDisplay();
  if (!display) redirect("/pair");

  // Pull everything the menu needs in parallel — counts for the tile
  // badges + the full user payload (carries `permissions: string[]`)
  // so each tile can decide whether to render.
  const [viewer, pendingLots, incoming, pendingDispatches] = await Promise.all([
    getInspectionViewer(),
    listPendingPutaway(),
    getMobileIncoming(),
    listPendingDispatches(),
  ]);

  // Submitted inspections are the ones waiting on QC sign-off. The
  // mobile incoming response embeds the most-recent inspection per
  // PO so we filter on `submitted` for the QC tile badge.
  const submittedInspectionCount =
    incoming?.items.filter(
      (row) => row.open_inspection?.status === "submitted",
    ).length ?? 0;

  return (
    <MobileHomeShell
      display={display}
      viewerPermissions={viewer?.permissions ?? []}
      isAdmin={viewer?.is_admin ?? false}
      pendingPutawayCount={pendingLots.length}
      incomingTodayCount={incoming?.items.length ?? 0}
      submittedInspectionCount={submittedInspectionCount}
      pendingThreePlDispatchCount={pendingDispatches.length}
    />
  );
}

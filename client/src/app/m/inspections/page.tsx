import { redirect } from "next/navigation";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { getInspectionViewer } from "@/lib/goods-in/server";
import { listInspectionsPage } from "@/lib/inspections/server";
import { MobileInspectionsList } from "./mobile-inspections-list";

export const metadata = { title: "Inspections · PSP Mobile" };

export const dynamic = "force-dynamic";

/**
 * Mobile inspections ledger — the consolidated entry point that
 * replaced the dead-end "QC sign-off" + "My inspections" home tiles.
 * Approvers land on "Needs sign-off" by default; viewers without
 * approve perm land on "All recent". The list is tap-to-open and
 * routes to the wizard (or its read-only summary if the inspection
 * is no longer in draft).
 */
export default async function MobileInspectionsPage() {
  const [deviceToken, sessionToken] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  if (!deviceToken && !sessionToken) {
    redirect("/login?next=%2Fm%2Finspections");
  }

  // Pull the first page server-side so the operator gets a paint
  // before the client takes over. The default chip is approver-aware
  // so the SSR fetch matches what the FE will paint after hydration.
  const [viewer, initialNeedsSignOff, initialMine, initialRecent] =
    await Promise.all([
      getInspectionViewer(),
      listInspectionsPage({ query: "status=submitted&limit=25" }),
      listInspectionsPage({ query: "mine=true&limit=25" }),
      listInspectionsPage({ query: "limit=25" }),
    ]);

  const canApprove =
    viewer?.is_admin === true ||
    (viewer?.permissions ?? []).includes("goods_in.approve");

  return (
    <MobileInspectionsList
      canApprove={canApprove}
      initialPages={{
        needs_sign_off: initialNeedsSignOff?.items ?? [],
        mine: initialMine?.items ?? [],
        recent: initialRecent?.items ?? [],
      }}
    />
  );
}

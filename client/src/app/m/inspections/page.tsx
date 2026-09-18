import { redirect } from "next/navigation";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { getInspectionViewer } from "@/lib/goods-in/server";
import { listInspectionsPage } from "@/lib/inspections/server";
import { MobileInspectionsList } from "./mobile-inspections-list";

export const metadata = { title: "Inspections · PSP Mobile" };

export const dynamic = "force-dynamic";

/**
 * Mobile inspections ledger — the consolidated entry point for
 * every open inspection (both PO deliveries + RMA returns). Default
 * tab is "To do" (drafts an operator needs to fill + submitted rows
 * awaiting QA) for everyone with view perm so a fresh inspection
 * lands the eye on landing.
 */
export default async function MobileInspectionsPage() {
  const [deviceToken, sessionToken] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  if (!deviceToken && !sessionToken) {
    redirect("/login?next=%2Fm%2Finspections");
  }

  const [viewer, initialToDo, initialMine, initialRecent] =
    await Promise.all([
      getInspectionViewer(),
      listInspectionsPage({ query: "status=open&limit=25" }),
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
        to_do: initialToDo?.items ?? [],
        mine: initialMine?.items ?? [],
        recent: initialRecent?.items ?? [],
      }}
    />
  );
}

import { notFound, redirect } from "next/navigation";
import { getCompanyDefaults } from "@/lib/company/server";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import {
  getInspection,
  getInspectionViewer,
} from "@/lib/goods-in/server";
import { getPurchaseOrder } from "@/lib/purchase-orders/server";
import { MobileInspectionWizard } from "./mobile-inspection-wizard";

export const metadata = { title: "Goods-In · PSP Mobile" };

interface Props {
  params: Promise<{ uuid: string }>;
  searchParams: Promise<{ lines?: string | string[] }>;
}

/**
 * Mobile Goods-In Inspection wizard route. Accessible to either:
 *   - a paired dock tablet (device token cookie present) — the
 *     operator's main flow at the receiving bay
 *   - a laptop session (QC team approving from their desk)
 *
 * Either auth gate satisfies the page; the BE still enforces RBAC on
 * every action (`goods_in.inspect` vs `goods_in.approve`).
 */
export default async function MobileInspectionPage({
  params,
  searchParams,
}: Props) {
  const deviceToken = await getDeviceToken();
  const sessionToken = await getSessionToken();
  if (!deviceToken && !sessionToken) redirect("/pair");

  const { uuid } = await params;
  const sp = await searchParams;
  // `?lines=uuid1,uuid2,uuid3` — set by the pre-receive hub when the
  // operator ticks which items came on the truck. Wizard seeds its
  // per-line walk from this so it skips straight to the picked items.
  // Fresh inspections only — if the inspection already has saved
  // items, the wizard prefers those over the URL param.
  const rawLines = sp.lines;
  const initialSelectedLineUuids: string[] =
    typeof rawLines === "string"
      ? rawLines.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  // Bulk SSR fetch — inspection + viewer + company defaults in
  // parallel. The inspection payload carries the parent PO uuid
  // (preloaded), so we kick off the PO fetch on the next tick once
  // we have it. Company defaults feed date formatting on the
  // wizard's `<DateField>`s (delivery date + per-pack manufactured
  // / expiry) per the CLAUDE.md rule.
  const [inspection, viewer, defaults] = await Promise.all([
    getInspection(uuid),
    getInspectionViewer(),
    getCompanyDefaults(),
  ]);
  if (!inspection || !viewer) notFound();
  if (!inspection.purchase_order_uuid) notFound();

  const purchaseOrder = await getPurchaseOrder(inspection.purchase_order_uuid);
  if (!purchaseOrder) notFound();

  return (
    <MobileInspectionWizard
      inspection={inspection}
      purchaseOrder={purchaseOrder}
      viewer={viewer}
      initialSelectedLineUuids={initialSelectedLineUuids}
      prefs={defaults}
    />
  );
}

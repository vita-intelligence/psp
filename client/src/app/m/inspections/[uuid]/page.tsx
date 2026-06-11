import { notFound, redirect } from "next/navigation";
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
export default async function MobileInspectionPage({ params }: Props) {
  const deviceToken = await getDeviceToken();
  const sessionToken = await getSessionToken();
  if (!deviceToken && !sessionToken) redirect("/pair");

  const { uuid } = await params;

  // Bulk SSR fetch — inspection + viewer in parallel. The inspection
  // payload carries the parent PO uuid (preloaded), so we kick off the
  // PO fetch on the next tick once we have it.
  const [inspection, viewer] = await Promise.all([
    getInspection(uuid),
    getInspectionViewer(),
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
    />
  );
}

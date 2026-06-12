import { notFound, redirect } from "next/navigation";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { listInspectionsForPo } from "@/lib/goods-in/server";
import { getPurchaseOrder } from "@/lib/purchase-orders/server";
import { MobilePreReceiveCard } from "./mobile-pre-receive-card";

export const metadata = { title: "Pre-receive · PSP Mobile" };

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ uuid: string }>;
}

/**
 * "What to expect" pre-receive checklist — the step between the
 * Goods-in board and the inspection wizard. Operator scans the truck,
 * pulls up this card, and cross-checks vendor paperwork line-by-line
 * against the PO. No edits happen here; per the PSP collab rule this
 * is a read-only detail page so the realtime channel is skipped.
 *
 * The "Start receiving" CTA either jumps into the existing open
 * inspection or kicks the create-draft action and then jumps. That
 * branching lives on the client side so the operator's tap is
 * single-press even when a teammate already started one yesterday.
 */
export default async function MobilePreReceivePage({ params }: Props) {
  const [deviceToken, sessionToken] = await Promise.all([
    getDeviceToken(),
    getSessionToken(),
  ]);
  if (!deviceToken && !sessionToken) {
    const { uuid } = await params;
    redirect(`/login?next=%2Fm%2Fincoming%2F${encodeURIComponent(uuid)}`);
  }

  const { uuid } = await params;

  // Pull the PO + any non-terminal inspections that already exist for
  // it in parallel. The inspection list lets the CTA decide between
  // "resume the draft" and "create one".
  const [purchaseOrder, inspections] = await Promise.all([
    getPurchaseOrder(uuid),
    listInspectionsForPo(uuid),
  ]);

  if (!purchaseOrder) notFound();

  const openInspection =
    inspections.find(
      (i) => i.status === "draft" || i.status === "submitted",
    ) ?? null;

  return (
    <MobilePreReceiveCard
      purchaseOrder={purchaseOrder}
      openInspection={openInspection}
    />
  );
}

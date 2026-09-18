import { notFound, redirect } from "next/navigation";
import { getCompanyDefaults } from "@/lib/company/server";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import {
  getInspection,
  getInspectionViewer,
} from "@/lib/goods-in/server";
import { getPurchaseOrder } from "@/lib/purchase-orders/server";
import type {
  Inspection,
  InspectionCustomerReturn,
} from "@/lib/goods-in/types";
import type { PurchaseOrder, PurchaseOrderLine } from "@/lib/types";
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
 * Supports two inspection sources:
 *   - PO-backed (supplier delivery — original path)
 *   - RMA-backed (customer return — spawned by mark-received)
 *
 * The wizard component consumes a `PurchaseOrder`-shaped object; for
 * RMA-backed inspections we synthesize one from
 * `inspection.customer_return` so the same rendering code walks
 * either source without branching per widget.
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
  const rawLines = sp.lines;
  const initialSelectedLineUuids: string[] =
    typeof rawLines === "string"
      ? rawLines.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  const [inspection, viewer, defaults] = await Promise.all([
    getInspection(uuid),
    getInspectionViewer(),
    getCompanyDefaults(),
  ]);
  if (!inspection || !viewer) notFound();

  const purchaseOrder = inspection.purchase_order_uuid
    ? await getPurchaseOrder(inspection.purchase_order_uuid)
    : synthesizePOFromRMA(inspection);
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

/**
 * Build a PO-shaped envelope from an RMA so the wizard component,
 * which is tightly bound to `PurchaseOrder` + `PurchaseOrderLine`,
 * can render an RMA-backed inspection with zero code changes.
 *
 * The FK the wizard actually cares about is `line.uuid` — that's
 * what gets passed to `POST /api/goods-in-inspections/:id/items/:line_uuid`.
 * The backend resolves the uuid against either PO lines or RMA lines
 * (see `fetch_source_line/2`), so mirroring RMA line uuids onto the
 * synthetic PO lines Just Works.
 */
function synthesizePOFromRMA(inspection: Inspection): PurchaseOrder | null {
  const rma = inspection.customer_return;
  if (!rma) return null;

  const lines: PurchaseOrderLine[] = rma.lines.map((line) => ({
    uuid: line.uuid,
    purchase_order_id: 0,
    item_id: line.item_id ?? 0,
    item: line.item
      ? {
          id: line.item.id,
          uuid: line.item.uuid,
          code: line.item.code,
          name: line.item.name,
          item_type: "finished_product",
          external_sku: null,
          compliance_status: "ready_for_use",
          storage_tags: [],
          attributes: {},
          stock_uom: null,
        }
      : null,
    qty_ordered: line.qty_returned,
    qty_received: "0",
    unit_price: line.unit_price ?? "0",
    line_subtotal: "0",
    expected_delivery_date: null,
    notes: line.reason_code ? `Return reason: ${line.reason_code}` : null,
    warehouse_id: null,
    warehouse: null,
    vendor_part_no: null,
    child_lot: null,
    inserted_at: inspection.inserted_at,
    updated_at: inspection.updated_at,
  }));

  return {
    id: rma.id,
    uuid: rma.uuid,
    code: rma.code,
    status: "ordered",
    vendor_id: 0,
    vendor: rma.customer
      ? {
          id: rma.customer.id,
          uuid: rma.customer.uuid,
          name: rma.customer.name,
          code: null,
        }
      : null,
    currency_code: "GBP",
    subtotal: "0",
    discount_pct: "0",
    discount_amount: "0",
    tax_rate: "0",
    tax_amount: "0",
    shipping_fees: "0",
    additional_fees: "0",
    grand_total: "0",
    default_warehouse_id: null,
    default_warehouse: null,
    is_rnd: false,
    delivery_address: null,
    expected_delivery_date: inspection.delivery_date,
    ordered_at: null,
    received_at: null,
    approvals: [],
    files: [],
    lines,
    notes: null,
    created_at: rma.customer ? undefined : undefined,
    inserted_at: inspection.inserted_at,
    updated_at: inspection.updated_at,
    created_by: null,
    updated_by: null,
  } as unknown as PurchaseOrder;
}

// Reference to silence "unused import" warning when RMA
// synthesis stays in this file — the exported alias keeps the
// type explicit for anyone editing the synthesis helper.
export type { InspectionCustomerReturn };

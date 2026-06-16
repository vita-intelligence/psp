import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCompanyDefaults } from "@/lib/company/server";
import { getInspection } from "@/lib/goods-in/server";
import { getPurchaseOrder } from "@/lib/purchase-orders/server";
import { renderQuarantineLabelPdf } from "@/lib/stock/quarantine-label-pdf";

// pdfkit pulls Node-only deps — opt-out of edge runtime explicitly.
export const runtime = "nodejs";

/**
 * GET /api/m/inspections/[uuid]/quarantine-label.pdf
 *   ?line_uuid=…&pack_index=N&copies=K
 *
 * Renders a quarantine label PDF for ONE pack on a goods-in
 * inspection. Lots don't exist yet at this point (they're materialised
 * on QC approval), so the label identity comes from the inspection
 * code + per-line + pack index. The QR encodes a deep-link to the
 * inspection so a reader anywhere on the dock can pull the source.
 *
 * Auth: device-token-first / session-token fallback — both phone and
 * laptop sessions can render this PDF (the laptop is what actually
 * prints, but the phone CAN preview by hitting the URL directly).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  const lineUuid = req.nextUrl.searchParams.get("line_uuid");
  const packIndex = parsePackIndex(req.nextUrl.searchParams.get("pack_index"));
  const copies = parseCopies(req.nextUrl.searchParams.get("copies"));

  if (!lineUuid || packIndex === null) {
    return NextResponse.json(
      {
        error: "bad_request",
        detail: "Missing line_uuid or pack_index.",
      },
      { status: 400 },
    );
  }

  const [inspection, defaults, hdrs] = await Promise.all([
    getInspection(uuid),
    getCompanyDefaults(),
    headers(),
  ]);

  if (!inspection) {
    return NextResponse.json(
      { error: "not_found", detail: "Inspection not found." },
      { status: 404 },
    );
  }

  // Find the matching inspection_item + the parent PO line. The PO
  // round-trip is the cheapest way to recover line metadata (item
  // name, code, UoM, vendor part no) without inflating the
  // inspection payload.
  const item = inspection.items.find(
    (it) => it.purchase_order_line_uuid === lineUuid,
  );
  if (!item) {
    return NextResponse.json(
      {
        error: "not_found",
        detail: "No pack data captured for this line — open the wizard and add packs first.",
      },
      { status: 404 },
    );
  }

  const pack = item.packs?.[packIndex];
  if (!pack) {
    return NextResponse.json(
      {
        error: "not_found",
        detail: `Pack ${packIndex + 1} not found.`,
      },
      { status: 404 },
    );
  }

  const po = inspection.purchase_order_uuid
    ? await getPurchaseOrder(inspection.purchase_order_uuid)
    : null;
  const line = po?.lines.find((l) => l.uuid === lineUuid) ?? null;

  // QR points back at the inspection page so a dock scan opens the
  // wizard / read-only summary the label originated from.
  const proto = hdrs.get("x-forwarded-proto") || "http";
  const host = hdrs.get("x-forwarded-host") || hdrs.get("host") || "";
  const inspectionUrl = `${proto}://${host}/m/inspections/${uuid}`;

  const pdf = await renderQuarantineLabelPdf({
    inspectionCode: inspectionLikeCode(inspection),
    inspectionUuid: uuid,
    inspectionDate: inspection.delivery_date,
    poCode: po?.code ?? null,
    vendorName: po?.vendor?.name ?? null,
    itemName: line?.item?.name ?? "Unknown item",
    itemCode: line?.item?.code ?? null,
    qty: String(pack.qty ?? "0"),
    uomSymbol:
      line?.item?.stock_uom?.symbol ?? line?.item?.stock_uom?.code ?? null,
    packIndex,
    packCount: item.packs?.length ?? 1,
    packLengthMm: Number(pack.package_length_mm) || 0,
    packWidthMm: Number(pack.package_width_mm) || 0,
    packHeightMm: Number(pack.package_height_mm) || 0,
    packWeightKg: String(pack.package_weight_kg ?? "0"),
    supplierBatchNo: pack.supplier_batch_no ?? null,
    companyName: defaults?.name ?? "PSP",
    inspectionUrl,
    copies,
    prefs: defaults ?? {},
  });

  const filename = `quarantine-${inspectionLikeCode(inspection) ?? uuid.slice(0, 8)}-pack${packIndex + 1}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// Inspection payload doesn't currently carry a `code` field on the FE
// type — fall back to the uuid prefix so the label still has a usable
// identity even before Numbering surfaces the GI sequence here.
function inspectionLikeCode(inspection: {
  uuid: string;
  delivery_date?: string | null;
}): string | null {
  return `GI-${inspection.uuid.slice(0, 8).toUpperCase()}`;
}

function parsePackIndex(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

function parseCopies(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

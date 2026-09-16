import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCompanyDefaults } from "@/lib/company/server";
import { getEquipment } from "@/lib/equipment/server";
import { renderEquipmentLabelPdf } from "@/lib/equipment/label-pdf";

// pdfkit pulls Node-only deps — opt out of the edge runtime.
export const runtime = "nodejs";

/**
 * GET /api/equipment/[uuid]/label.pdf?copies=N
 *
 * Streams an inline PDF the operator can preview + print. Mirrors
 * the stock-lot label endpoint — same 100×60mm page geometry, same
 * layout skeleton, so a shared thermal-printer profile prints both.
 *
 * The QR encodes the mobile detail URL so a scan from any paired
 * phone lands on `/m/equipment/<uuid>` (see scan dispatcher).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  const copies = parseCopies(req.nextUrl.searchParams.get("copies"));

  const [equipment, defaults, hdrs] = await Promise.all([
    getEquipment(uuid),
    getCompanyDefaults(),
    headers(),
  ]);

  if (!equipment) {
    return NextResponse.json(
      { error: "not_found", detail: "Equipment not found." },
      { status: 404 },
    );
  }

  // QR encodes an absolute URL to the mobile detail page. Read
  // protocol + host from the request so the label works no matter
  // which host the operator is on (localhost, .local, prod).
  const proto = hdrs.get("x-forwarded-proto") || "https";
  const host = hdrs.get("x-forwarded-host") || hdrs.get("host") || "";
  const scanUrl = `${proto}://${host}/m/equipment/${uuid}`;

  const pdf = await renderEquipmentLabelPdf({
    equipment,
    companyName: defaults?.name ?? "PSP",
    scanUrl,
    copies,
    prefs: defaults ?? {},
  });

  const filename = `${equipment.code ?? `equipment-${equipment.id}`}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function parseCopies(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

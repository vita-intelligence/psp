import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCompanyDefaults } from "@/lib/company/server";
import { getStockLot } from "@/lib/stock/server";
import { renderLabelPdf } from "@/lib/stock/label-pdf";

// pdfkit pulls Node-only deps — opt-out of edge runtime explicitly.
export const runtime = "nodejs";

/**
 * GET /api/stock/lots/[uuid]/label.pdf?copies=N
 *
 * Streams an inline PDF the operator can preview + print from any
 * browser. Mirrors MRPEasy's pattern — operator clicks the print
 * icon, picks N in a modal, the request opens a new tab with the
 * PDF rendered inline at exactly 100×60mm per page.
 *
 * Auth comes via the session cookie (the proxy helpers inside
 * `getStockLot` / `getCompanyDefaults` already attach the bearer);
 * a missing session yields a 404 since the lot lookup returns null.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  const copies = parseCopies(req.nextUrl.searchParams.get("copies"));

  const [data, defaults, hdrs] = await Promise.all([
    getStockLot(uuid),
    getCompanyDefaults(),
    headers(),
  ]);

  if (!data) {
    return NextResponse.json(
      { error: "not_found", detail: "Lot not found." },
      { status: 404 },
    );
  }

  // QR encodes an absolute URL so a scan from anywhere opens the lot.
  // Read protocol + host from the request so it matches whatever the
  // operator is on (localhost, .local, prod).
  const proto = hdrs.get("x-forwarded-proto") || "http";
  const host = hdrs.get("x-forwarded-host") || hdrs.get("host") || "";
  const lotUrl = `${proto}://${host}/stock/lots/${uuid}`;

  const pdf = await renderLabelPdf({
    lot: data.lot,
    companyName: defaults?.name ?? "PSP",
    lotUrl,
    copies,
    prefs: defaults ?? {},
  });

  const filename = `${data.lot.code ?? `lot-${data.lot.id}`}.pdf`;

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

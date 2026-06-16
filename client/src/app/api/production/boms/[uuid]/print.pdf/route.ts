import { NextRequest, NextResponse } from "next/server";
import { getCompanyDefaults } from "@/lib/company/server";
import { getBOM } from "@/lib/production/server";
import { renderBOMPdf } from "@/lib/production/bom-pdf";

// pdfkit pulls Node-only deps — opt-out of edge runtime explicitly.
export const runtime = "nodejs";

/**
 * GET /api/production/boms/[uuid]/print.pdf
 *
 * Inline PDF the operator can preview + print from the browser.
 * Header + parts + average cost + version history. Auth lands via
 * `getBOM()` reading the session cookie — a missing session yields
 * a 404 since the BOM lookup returns null.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;

  const [bom, defaults] = await Promise.all([
    getBOM(uuid),
    getCompanyDefaults(),
  ]);

  if (!bom) {
    return NextResponse.json(
      { error: "not_found", detail: "BOM not found." },
      { status: 404 },
    );
  }

  const pdf = await renderBOMPdf({
    bom,
    companyName: defaults?.name ?? "PSP",
    prefs: defaults ?? {},
  });

  const filename = `${bom.code ?? `bom-${bom.id}`}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

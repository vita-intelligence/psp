import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCompanyDefaults } from "@/lib/company/server";
import { getMachine } from "@/lib/production/server";
import { renderMachineLabelPdf } from "@/lib/production/machine-label-pdf";

// pdfkit pulls Node-only deps — opt-out of edge runtime explicitly.
export const runtime = "nodejs";

/**
 * GET /api/production/machines/[uuid]/label.pdf?copies=N
 *
 * Same shape as `/api/stock/lots/[uuid]/label.pdf` — inline PDF at
 * 100×60 mm/page, one page per copy. Operators stick the label on
 * the machine; a phone scan of the QR opens the mobile detail view.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  const copies = parseCopies(req.nextUrl.searchParams.get("copies"));

  const [machine, defaults, hdrs] = await Promise.all([
    getMachine(uuid),
    getCompanyDefaults(),
    headers(),
  ]);

  if (!machine) {
    return NextResponse.json(
      { error: "not_found", detail: "Machine not found." },
      { status: 404 },
    );
  }

  // QR encodes the desktop URL. The mobile /m/scan handler rewrites
  // `/production/machines/<uuid>` → `/m/machines/<uuid>` so a phone
  // scan lands on the phone-friendly view, while a desktop scan just
  // opens the full detail page. Same pattern lots use.
  const proto = hdrs.get("x-forwarded-proto") || "http";
  const host = hdrs.get("x-forwarded-host") || hdrs.get("host") || "";
  const machineUrl = `${proto}://${host}/production/machines/${uuid}`;

  const pdf = await renderMachineLabelPdf({
    machine,
    companyName: defaults?.name ?? "PSP",
    machineUrl,
    copies,
    prefs: defaults ?? {},
  });

  const filename = `${machine.asset_tag ?? machine.name.replace(/\s+/g, "-")}.pdf`;

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

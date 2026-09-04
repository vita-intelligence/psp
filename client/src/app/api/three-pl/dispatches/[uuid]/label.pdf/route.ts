import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCompanyDefaults } from "@/lib/company/server";
import { getDispatchAnyState } from "@/lib/three-pl/server";
import { renderThreePlLabelPdf } from "@/lib/three-pl/label-pdf";

// pdfkit ships Node-only deps — opt out of the edge runtime.
export const runtime = "nodejs";

/**
 * GET /api/three-pl/dispatches/[uuid]/label.pdf?copies=N
 *
 * Prints the customer-scoped 3PL dispatch label. One label per
 * order, printed once at Move time — subsequent stages (Paperwork,
 * Pickup, Return) reuse the same QR because it resolves to the
 * current stage on scan.
 *
 * Accepts a Dispatch in ``pending`` (Move) OR ``return_pending``
 * (Return) state; ``completed`` dispatches also print because the
 * outbound Shipment still needs the same physical label follow
 * through Paperwork + Pickup.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  const copies = parseCopies(req.nextUrl.searchParams.get("copies"));

  const [dispatch, defaults, hdrs] = await Promise.all([
    getDispatchAnyState(uuid),
    getCompanyDefaults(),
    headers(),
  ]);

  if (!dispatch) {
    return NextResponse.json(
      { error: "not_found", detail: "Dispatch not found." },
      { status: 404 },
    );
  }

  // QR encodes the scan-to-open resolver so a scan on any paired
  // phone lands on the current-stage screen without the printed
  // label needing to know today what stage the order will be on
  // tomorrow.
  //
  // Scheme comes from the incoming request itself (``next/server``
  // exposes it on ``req.nextUrl``) — the old ``x-forwarded-proto``
  // sniff fell back to "http" in dev where PSP runs on ``https``
  // via ``--experimental-https``, so the QR resolved to a URL that
  // 404'd in the browser. Now it inherits whatever the operator
  // is actually on (localhost:3010, maksyms-macbook-pro.local:3010,
  // etc.) automatically.
  const proto =
    hdrs.get("x-forwarded-proto") ||
    req.nextUrl.protocol.replace(":", "") ||
    "https";
  const host = hdrs.get("x-forwarded-host") || hdrs.get("host") || req.nextUrl.host;
  const scanUrl = `${proto}://${host}/scan/three-pl/${uuid}`;

  const pdf = await renderThreePlLabelPdf({
    dispatch,
    companyName: defaults?.name ?? "PSP",
    scanUrl,
    copies,
    prefs: defaults ?? {},
  });

  const filename = `3pl-${dispatch.reference ?? uuid.slice(0, 8)}.pdf`;

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

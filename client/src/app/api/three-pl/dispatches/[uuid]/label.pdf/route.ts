import os from "node:os";
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
  // 404'd in the browser.
  //
  // Host: the laptop opens PSP at ``localhost:3010`` but the phone
  // scanning the printed label can't resolve ``localhost`` (that's
  // the phone itself). Swap loopback hosts for the machine's
  // Bonjour name (``os.hostname()`` → ``something.local`` on macOS
  // dev) so the same URL works from anything on the LAN. In prod
  // the ``Host`` header is a real domain and the loopback check
  // short-circuits.
  const proto =
    hdrs.get("x-forwarded-proto") ||
    req.nextUrl.protocol.replace(":", "") ||
    "https";
  const rawHost = hdrs.get("x-forwarded-host") || hdrs.get("host") || req.nextUrl.host;
  const host = lanReachableHost(rawHost);
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

// Loopback hosts (``localhost``, ``127.0.0.1``, ``[::1]``) only
// resolve to the machine that issued the request — a phone scanning
// a QR that encodes ``http://localhost:3010/...`` hits its own
// loopback and 404s. In dev we swap for the Mac's Bonjour name so
// anything on the same LAN can follow the QR. In prod the ``Host``
// header is a real domain (or a proxy-forwarded one) and we return
// it unchanged.
function lanReachableHost(host: string): string {
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
  if (!loopback.test(host)) return host;
  const port = host.match(/:(\d+)$/)?.[1];
  const bonjour = normaliseBonjour(os.hostname());
  return port ? `${bonjour}:${port}` : bonjour;
}

function normaliseBonjour(hostname: string): string {
  // Explicit override wins — set ``PSP_LAN_HOST=host:port`` (or
  // just ``host``) in ``.env.local`` for setups where Bonjour
  // isn't the right answer (dev tunnels, custom /etc/hosts, etc.).
  const override = process.env.PSP_LAN_HOST?.trim();
  if (override) return override;
  // On macOS ``os.hostname()`` can return the DHCP-side suffix
  // (``Maksyms-MBP.lan``) rather than the Bonjour LocalHostName
  // (``Maksyms-MBP.local``). The DHCP form isn't resolvable from
  // most other devices on the LAN; the Bonjour form is. Strip any
  // suffix and force ``.local`` so a phone scanning the QR can
  // always follow it.
  const short = hostname.trim().replace(/\.$/, "").split(".")[0] || hostname;
  return `${short}.local`;
}

import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";

/**
 * Same-origin HTML proxy — fetches the NPD-rendered spec sheet from
 * the Phoenix backend, forwarding the PSP session bearer, and streams
 * the HTML body back to the browser. The iframe on the Output-QC
 * detail page points at this URL so:
 *
 *   * the iframe stays same-origin (no cross-origin auth headaches),
 *   * the browser never sees an NPD URL or the integration bearer,
 *   * the PSP session cookie gates the entire chain end-to-end.
 *
 * Phoenix's controller does the actual server-to-server call to
 * `/api/psp-integration/specifications/latest.html` on NPD.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ lot_uuid: string }> },
) {
  const token = await getSessionToken();
  if (!token) {
    return new NextResponse("<h1>Unauthorized</h1>", {
      status: 401,
      headers: { "content-type": "text/html" },
    });
  }

  const { lot_uuid } = await params;
  const upstream = `${env.apiUrl}/api/production/output-qc/${encodeURIComponent(
    lot_uuid,
  )}/npd-spec.html`;

  const res = await fetch(upstream, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/html",
    },
    cache: "no-store",
  });

  if (res.status === 401) {
    await clearSessionCookie();
  }

  const html = await res.text();
  return new NextResponse(html, {
    status: res.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "SAMEORIGIN",
    },
  });
}

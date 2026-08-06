import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";

/**
 * Same-origin HTML proxy for the NPD product-validation sheet on the
 * Output-QC detail page. Mirrors the sibling `npd-spec.html` route:
 * forwards the PSP session bearer to Phoenix, which does the actual
 * server-to-server call to NPD. Keeping the iframe same-origin means
 * the browser never sees an NPD URL or the integration bearer, and
 * the PSP session cookie gates the whole chain.
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
  )}/npd-validation.html`;

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

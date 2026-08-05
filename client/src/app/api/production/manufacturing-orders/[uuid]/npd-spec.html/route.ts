import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";

/**
 * Same-origin HTML proxy for the MO detail page's spec-sheet embed.
 * Forwards the PSP session bearer to Phoenix; Phoenix does the
 * server-to-server call to NPD. Mirrors
 * `output-qc/[lot_uuid]/npd-spec.html/route.ts`.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const token = await getSessionToken();
  if (!token) {
    return new NextResponse("<h1>Unauthorized</h1>", {
      status: 401,
      headers: { "content-type": "text/html" },
    });
  }

  const { uuid } = await params;
  const upstream = `${env.apiUrl}/api/production/manufacturing-orders/${encodeURIComponent(
    uuid,
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

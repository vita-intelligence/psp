import { NextRequest, NextResponse } from "next/server";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { env } from "@/lib/env";

/**
 * Stream the image bytes through the Next proxy so the browser's
 * `<img src>` can use the regular session cookie without ever seeing
 * the bearer token. The Phoenix endpoint enforces RBAC + cross-company
 * scoping; we just forward the body.
 *
 * No JSON shaping here — we pass through `content-type` + raw stream
 * so the image renders directly.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ uuid: string; imageUuid: string }> },
) {
  const { uuid, imageUuid } = await ctx.params;
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Your session has expired." },
      { status: 401 },
    );
  }

  const upstream = `${env.apiUrl}/api/items/${uuid}/images/${imageUuid}/file`;

  const res = await fetch(upstream, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (res.status === 401) {
    await clearSessionCookie();
  }
  if (!res.ok) {
    return new NextResponse(null, { status: res.status });
  }

  return new NextResponse(res.body, {
    status: 200,
    headers: {
      "Content-Type":
        res.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "private, max-age=60",
    },
  });
}

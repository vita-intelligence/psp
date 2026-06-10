import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getDeviceToken } from "@/lib/devices/server";

export const runtime = "nodejs";

/**
 * Proxy the photo upload to Phoenix carrying the device bearer.
 *
 * We don't use the typed `api()` helper here because multipart bodies
 * need the browser-formed boundary header — we forward the incoming
 * Request body straight through without re-parsing.
 */
export async function POST(req: Request) {
  const token = await getDeviceToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const upstream = await fetch(`${env.apiUrl}/api/stock/movement-photos`, {
    method: "POST",
    body: req.body,
    // @ts-expect-error — Node fetch needs duplex when streaming a body.
    duplex: "half",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": req.headers.get("content-type") ?? "application/octet-stream",
    },
  });

  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

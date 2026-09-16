import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

/**
 * Stream-proxy the file bytes from the Phoenix backend.
 *
 * The FE renders an `<a href="/api/equipment/:uuid/files/:fileUuid/blob">`
 * link on the equipment detail page. Next.js needs this dynamic route
 * to forward the request (with the session Authorization header
 * attached) to the backend at
 * `PHOENIX_URL/api/equipment/:uuid/files/:fileUuid/blob`.
 *
 * Without this proxy the browser hits Next.js directly and gets a
 * 404 — the backend accepts JWT via the `Authorization` header,
 * which the browser can't attach on a bare `<a>` click.
 */
export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{ uuid: string; fileUuid: string }>;
  },
) {
  const t = await token();
  if (!t) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const { uuid, fileUuid } = await params;
  const upstream = await fetch(
    `${env.apiUrl}/api/equipment/${encodeURIComponent(uuid)}/files/${encodeURIComponent(fileUuid)}/blob`,
    { headers: { Authorization: `Bearer ${t}` } },
  );
  if (!upstream.ok || !upstream.body) {
    return new NextResponse("not_found", { status: upstream.status });
  }
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition":
        upstream.headers.get("content-disposition") ?? "inline",
    },
  });
}

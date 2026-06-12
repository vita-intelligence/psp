import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";

export const runtime = "nodejs";

/**
 * Streams a procurement invoice attachment (PDF / Excel / image) back
 * from Phoenix with the laptop session bearer attached.
 *
 * Mirrors the vendor-file proxy: the BE payload emits
 * `/api/procurement/invoices/<uuid>/file/serve` so a plain
 * `<a href="…">` resolves through Next and we add the auth header
 * server-side.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const upstream = await fetch(
    `${env.apiUrl}/api/procurement/invoices/${encodeURIComponent(uuid)}/file/serve`,
    {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "file_not_found" },
      { status: upstream.status },
    );
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition":
        upstream.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, max-age=300",
    },
  });
}

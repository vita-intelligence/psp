import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";

export const runtime = "nodejs";

/**
 * Streams a vendor evidence file (SAQ / audit / COA / cert PDF) back
 * from Phoenix carrying the laptop session bearer.
 *
 * Mirrors the movement-photo proxy: the canonical URL the backend
 * emits is `/api/vendors/<uuid>/files/<file_uuid>/serve` so an `<a
 * href="…">` resolves through Next and we attach the auth header.
 */
export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{ uuid: string; fileUuid: string }>;
  },
) {
  const { uuid, fileUuid } = await params;
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const upstream = await fetch(
    `${env.apiUrl}/api/vendors/${encodeURIComponent(uuid)}/files/${encodeURIComponent(fileUuid)}/serve`,
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

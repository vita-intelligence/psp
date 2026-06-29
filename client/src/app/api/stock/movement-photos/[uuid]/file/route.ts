import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";

export const runtime = "nodejs";

/**
 * Streams a movement photo back from Phoenix. The backend stores the
 * canonical URL as `/api/stock/movement-photos/<uuid>/file` (so it
 * survives a storage-adapter swap), and the browser hits THIS Next
 * route directly — which forwards to the Phoenix file endpoint
 * carrying the laptop session bearer, or the paired-device token
 * when the request comes from /m/* on a worker's phone.
 *
 * Without this proxy the `<img src="…">` resolves to
 * https://localhost:3000/api/stock/movement-photos/<uuid>/file, which
 * doesn't exist on Next and lands as a broken image.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const upstream = await fetch(
    `${env.apiUrl}/api/stock/movement-photos/${encodeURIComponent(uuid)}/file`,
    {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "photo_not_found" },
      { status: upstream.status },
    );
  }

  // Stream the bytes through. We pass content-type + length headers so
  // the browser handles the image natively.
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=300",
    },
  });
}

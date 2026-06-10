import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";

export const runtime = "nodejs";

/**
 * Laptop-side movement-photo upload. Mirrors the mobile proxy at
 * /api/m/movement-photos but carries the session bearer instead of
 * the device bearer — the laptop Move dialog uses this when the
 * operator attaches a photo from the file picker (no camera prompt).
 */
export async function POST(req: Request) {
  const token = await getSessionToken();
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
      "content-type":
        req.headers.get("content-type") ?? "application/octet-stream",
    },
  });

  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

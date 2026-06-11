import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";

export const runtime = "nodejs";

/**
 * Streams a goods-in inspection file (operator photo, supplier COA
 * PDF, etc.) back from Phoenix carrying the session bearer.
 *
 * Token resolution mirrors the wizard actions: device token first
 * (mobile dock), then laptop session (QC approving from their desk)
 * — so `<img src="/api/goods-in-inspections/..">` works in both
 * contexts without callers having to pick.
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
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const upstream = await fetch(
    `${env.apiUrl}/api/goods-in-inspections/${encodeURIComponent(uuid)}/files/${encodeURIComponent(fileUuid)}/serve`,
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

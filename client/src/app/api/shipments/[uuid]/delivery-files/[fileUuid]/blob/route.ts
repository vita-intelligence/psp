import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ uuid: string; fileUuid: string }> },
) {
  const t = await token();
  if (!t) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const { uuid, fileUuid } = await params;
  const upstream = await fetch(
    `${env.apiUrl}/api/shipments/${encodeURIComponent(uuid)}/delivery-files/${encodeURIComponent(fileUuid)}/blob`,
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

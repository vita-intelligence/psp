import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ uuid: string; fileUuid: string }> },
) {
  const t = await token();
  if (!t) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }
  const { uuid, fileUuid } = await params;
  const upstream = await fetch(
    `${env.apiUrl}/api/shipments/${encodeURIComponent(uuid)}/pickup-files/${encodeURIComponent(fileUuid)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${t}` } },
  );
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

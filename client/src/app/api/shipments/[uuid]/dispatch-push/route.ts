import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

// Desktop → phone push. The desktop shipment detail page hits this
// endpoint; Phoenix broadcasts `dispatch_open` on the operator's
// `user:<uuid>` channel; the paired mobile shell shows a slide-up
// banner that opens the mobile dispatch form on tap.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const t = await token();
  if (!t) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }
  const { uuid } = await params;
  const upstream = await fetch(
    `${env.apiUrl}/api/shipments/${encodeURIComponent(uuid)}/dispatch-push`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${t}`,
        "content-type": "application/json",
      },
      body: "{}",
    },
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

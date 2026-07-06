import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

// Multipart-upload proxy for truck-arrival dispatch photos. The
// browser sends the raw FormData here; we forward it verbatim to
// Phoenix so the file bytes never round-trip through a Next server
// action (which caps body size at 6 MB via next.config.ts).
export async function POST(
  req: Request,
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

  // Preserve the multipart Content-Type — it carries the boundary
  // Phoenix's parser needs to split the parts. Without it, `req.body`
  // is an opaque stream and the backend sees zero fields.
  const forwardHeaders: Record<string, string> = {
    Authorization: `Bearer ${t}`,
  };
  const ct = req.headers.get("content-type");
  if (ct) forwardHeaders["content-type"] = ct;
  const cl = req.headers.get("content-length");
  if (cl) forwardHeaders["content-length"] = cl;

  const upstream = await fetch(
    `${env.apiUrl}/api/shipments/${encodeURIComponent(uuid)}/pickup-files`,
    {
      method: "POST",
      headers: forwardHeaders,
      body: req.body,
      // @ts-expect-error — undici requires this for streaming bodies
      duplex: "half",
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

export async function GET(
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
    `${env.apiUrl}/api/shipments/${encodeURIComponent(uuid)}/pickup-files`,
    { headers: { Authorization: `Bearer ${t}` } },
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

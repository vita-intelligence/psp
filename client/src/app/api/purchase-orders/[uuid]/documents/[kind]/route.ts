import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";

export const runtime = "nodejs";

/**
 * Streams a generated PO document (internal PDF, vendor PDF, delivery
 * note, RFQ, CSV) back from Phoenix carrying the laptop session bearer.
 *
 * Why a proxy at all: PSP auth lives in a Next-side httpOnly cookie
 * and is forwarded as a `Bearer` header on every BE call. Opening
 * `localhost:4000/...` directly in a new tab has no header, so the BE
 * 401s. Same pattern as the vendor evidence file proxy.
 */
const ALLOWED_KINDS = [
  "internal-pdf",
  "vendor-pdf",
  "delivery-note",
  "rfq",
  "csv",
] as const;

type Kind = (typeof ALLOWED_KINDS)[number];

function isKind(value: string): value is Kind {
  return (ALLOWED_KINDS as readonly string[]).includes(value);
}

export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{ uuid: string; kind: string }>;
  },
) {
  const { uuid, kind } = await params;

  if (!isKind(kind)) {
    return NextResponse.json({ error: "unknown_kind" }, { status: 404 });
  }

  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const upstream = await fetch(
    `${env.apiUrl}/api/purchase-orders/${encodeURIComponent(uuid)}/documents/${kind}`,
    {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  if (!upstream.ok) {
    let body: unknown = null;
    try {
      body = await upstream.json();
    } catch {
      // upstream wasn't JSON — passthrough status only.
    }
    return NextResponse.json(body ?? { error: "document_unavailable" }, {
      status: upstream.status,
    });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition":
        upstream.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, no-store",
    },
  });
}

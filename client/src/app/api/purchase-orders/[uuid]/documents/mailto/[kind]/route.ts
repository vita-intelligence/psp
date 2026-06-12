import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";

export const runtime = "nodejs";

const ALLOWED = ["po", "rfq", "note"] as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ uuid: string; kind: string }> },
) {
  const { uuid, kind } = await params;

  if (!(ALLOWED as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "unknown_kind" }, { status: 404 });
  }

  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const upstream = await fetch(
    `${env.apiUrl}/api/purchase-orders/${encodeURIComponent(uuid)}/documents/mailto/${kind}`,
    {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  const body = await upstream.json().catch(() => ({}));
  return NextResponse.json(body, { status: upstream.status });
}

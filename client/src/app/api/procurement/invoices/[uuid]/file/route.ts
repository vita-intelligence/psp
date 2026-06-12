import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";

export const runtime = "nodejs";

/**
 * Multipart proxy for attaching the vendor's PDF to an invoice. Same
 * pattern as the vendor evidence upload — Next.js forwards the
 * multipart payload to Phoenix carrying the laptop session bearer.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const form = await req.formData();

  const upstream = await fetch(
    `${env.apiUrl}/api/procurement/invoices/${encodeURIComponent(uuid)}/file`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
      cache: "no-store",
    },
  );

  const body = await upstream.json().catch(() => ({}));
  return NextResponse.json(body, { status: upstream.status });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const upstream = await fetch(
    `${env.apiUrl}/api/procurement/invoices/${encodeURIComponent(uuid)}/file`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  const body = await upstream.json().catch(() => ({}));
  return NextResponse.json(body, { status: upstream.status });
}

import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

export async function GET(req: Request) {
  const t = await token();
  if (!t) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const path = qs.length > 0 ? `/api/my-tasks?${qs}` : "/api/my-tasks";
  const upstream = await fetch(`${env.apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${t}` },
    cache: "no-store",
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

export async function GET() {
  const t = await token();
  if (!t) {
    return NextResponse.json(
      { total: 0, overdue: 0, by_phase: {} },
      { status: 401 },
    );
  }
  const upstream = await fetch(`${env.apiUrl}/api/my-tasks/count`, {
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

import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  // Device token first (paired phone / tablet), session token fallback
  // (laptop dev-testing via /m). Mirrors the other /api/m proxies so
  // the directions card on the pickup flow renders for both.
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const data = await api(
      `/api/stock/floors/${encodeURIComponent(uuid)}/plan`,
      { token },
    );
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: err.code, detail: err.detail },
        { status: err.status || 500 },
      );
    }
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }
}

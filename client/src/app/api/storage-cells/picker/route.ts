import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Same-origin proxy for the tenant-wide storage-cell picker feed.
 *
 * Used by the equipment "Move" dialog on desktop and mobile, so it
 * accepts either the laptop session cookie or the paired-device
 * token — the mobile scan flow may drive a move too.
 */
export async function GET(req: NextRequest) {
  const token = (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) {
    return NextResponse.json(
      {
        error: "unauthorized",
        detail: "Your session has expired. Please sign in again.",
      },
      { status: 401 },
    );
  }

  const upstream = `/api/storage-cells/picker${req.nextUrl.search ?? ""}`;

  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/storage-cells/picker",
      fallbackDetail: "Couldn't load storage cells.",
    });
    return NextResponse.json(payload, { status });
  }
}

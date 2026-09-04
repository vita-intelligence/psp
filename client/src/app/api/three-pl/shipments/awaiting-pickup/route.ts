import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { toJsonError } from "@/lib/errors/server";

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

/**
 * GET /api/three-pl/shipments/awaiting-pickup?q=&cursor=&limit=
 *
 * Client-side proxy for the mobile 3PL hub's Pickup tab.
 */
export async function GET(req: Request) {
  const t = await token();
  if (!t) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }

  try {
    const src = new URL(req.url).searchParams;
    const dst = new URLSearchParams();
    for (const key of ["q", "cursor", "limit"]) {
      const v = src.get(key);
      if (v) dst.set(key, v);
    }
    const qs = dst.toString();
    const url =
      "/api/three-pl/shipments/awaiting-pickup" + (qs ? `?${qs}` : "");
    const data = await api(url, { token: t });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/three-pl/shipments/awaiting-pickup GET",
      fallbackDetail: "Couldn't load the pickup queue.",
    });
    return NextResponse.json(payload, { status });
  }
}

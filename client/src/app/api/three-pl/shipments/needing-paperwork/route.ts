import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { toJsonError } from "@/lib/errors/server";

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

/**
 * GET /api/three-pl/shipments/needing-paperwork?q=&cursor=&limit=
 *
 * Client-side proxy for the mobile 3PL hub's Paperwork tab. Server
 * component does the SSR first page; browser hits this route when
 * the user types in the search bar or scrolls past the sentinel.
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
      "/api/three-pl/shipments/needing-paperwork" + (qs ? `?${qs}` : "");
    const data = await api(url, { token: t });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/three-pl/shipments/needing-paperwork GET",
      fallbackDetail: "Couldn't load the paperwork queue.",
    });
    return NextResponse.json(payload, { status });
  }
}

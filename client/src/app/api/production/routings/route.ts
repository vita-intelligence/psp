import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Same-origin proxy for the routings ledger feed. Browser → Next →
 * Phoenix /api/production/routings. Same shape as other production
 * proxies — bearer cookie stays server-side.
 */
export async function GET(req: NextRequest) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Session expired." },
      { status: 401 },
    );
  }
  const upstream = `/api/production/routings${req.nextUrl.search ?? ""}`;
  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/production/routings",
      fallbackDetail: "Couldn't load routings.",
    });
    return NextResponse.json(payload, { status });
  }
}

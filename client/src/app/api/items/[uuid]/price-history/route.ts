import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Same-origin proxy for the item price-history feed consumed by the
 * PO wizard's per-line "History" popover. Session-cookie authed;
 * client-side `fetch` calls can't attach the backend's Authorization
 * header, so this route reads the httpOnly session cookie and
 * forwards it as a bearer token to Phoenix. Mirrors the pattern used
 * by every other `src/app/api/items/*` route handler.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Session expired." },
      { status: 401 },
    );
  }
  const { uuid } = await params;
  const limit = req.nextUrl.searchParams.get("limit") ?? "15";
  const qs = new URLSearchParams();
  qs.set("limit", limit);
  try {
    const data = await api(
      `/api/items/${encodeURIComponent(uuid)}/price-history?${qs.toString()}`,
      { token },
    );
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/items/[uuid]/price-history",
      fallbackDetail: "Couldn't load price history.",
    });
    return NextResponse.json(payload, { status });
  }
}

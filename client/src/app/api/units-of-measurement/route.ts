import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Proxy: browser → Next route → Phoenix /api/units-of-measurement.
 * Bearer lives in the httpOnly cookie; client JS never touches it.
 * Query params (cursor / sort / search / dimension) are forwarded
 * verbatim so DataTable and the dimension-filtered picker share the
 * same upstream.
 */
export async function GET(req: NextRequest) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      {
        error: "unauthorized",
        detail: "Your session has expired. Please sign in again.",
      },
      { status: 401 },
    );
  }

  const upstream = `/api/units-of-measurement${req.nextUrl.search ?? ""}`;

  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/units-of-measurement",
      fallbackDetail: "Couldn't load units of measurement.",
    });
    return NextResponse.json(payload, { status });
  }
}

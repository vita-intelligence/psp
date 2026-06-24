import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Same-origin proxy so the client-side DataTable can call
 * `/api/pricelists?...` without learning the upstream Phoenix host
 * or carrying the bearer in the browser.
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

  const upstream = `/api/pricelists${req.nextUrl.search ?? ""}`;

  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/pricelists",
      fallbackDetail: "Couldn't load pricelists.",
    });
    return NextResponse.json(payload, { status });
  }
}

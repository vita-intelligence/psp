import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

// Same-origin proxy for the movements audit list. The browser can't
// hit the Phoenix backend directly (session token lives in an
// HttpOnly cookie); this route pulls the token server-side and
// forwards with Bearer auth, mirroring every other /api/stock/*
// proxy on the client.
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

  const upstream = `/api/stock/movements${req.nextUrl.search ?? ""}`;

  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/stock/movements",
      fallbackDetail: "Couldn't load stock movements.",
    });
    return NextResponse.json(payload, { status });
  }
}

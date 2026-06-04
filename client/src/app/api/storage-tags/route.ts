import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Proxy: browser → Next route → Phoenix /api/storage-tags. The bearer
 * lives in the httpOnly cookie; client JS never touches it. Query
 * params are forwarded verbatim so the DataTable's cursor/sort/search
 * params (and the warehouse plan picker's `kind=` param) reach the
 * backend unchanged.
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

  const upstream = `/api/storage-tags${req.nextUrl.search ?? ""}`;

  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/storage-tags",
      fallbackDetail: "Couldn't load storage tags.",
    });
    return NextResponse.json(payload, { status });
  }
}

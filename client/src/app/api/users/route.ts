import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

// Proxy: browser → Next route → Phoenix /api/users.
//
// Forwards the full query string verbatim so the DataTable's cursor /
// sort / filter / search params reach the backend unchanged. Browser
// JS never touches the bearer token (httpOnly cookie); the structured
// error shape from Phoenix passes through so client-side error
// handling stays consistent.
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

  const upstream = `/api/users${req.nextUrl.search ?? ""}`;

  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/users",
      fallbackDetail: "Couldn't load users.",
    });
    return NextResponse.json(payload, { status });
  }
}

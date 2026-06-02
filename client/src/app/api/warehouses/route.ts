import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";

/**
 * Proxy: browser → Next route → Phoenix /api/warehouses. The bearer
 * lives in the httpOnly cookie; client JS never touches it. Query
 * params are forwarded verbatim so the DataTable's cursor/sort/filter/
 * search params reach the backend unchanged.
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

  const upstream = `/api/warehouses${req.nextUrl.search ?? ""}`;

  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) await clearSessionCookie();
      return NextResponse.json(
        { error: err.code, detail: err.detail, fields: err.fields },
        { status: err.status || 502 },
      );
    }
    return NextResponse.json(
      {
        error: "server_error",
        detail: "Something went wrong on our end. Please try again.",
      },
      { status: 500 },
    );
  }
}

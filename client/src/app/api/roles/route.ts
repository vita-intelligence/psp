import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";

// Proxy: browser → Next route → Phoenix /api/roles. Server fetcher
// `listTemplates` handles the SSR path; this route exists so client
// components (the "Apply template" popover on user-access) can refresh
// the list without bouncing through a server action.
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

  const upstream = `/api/roles${req.nextUrl.search ?? ""}`;

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

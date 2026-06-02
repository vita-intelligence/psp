import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";

// Proxy: browser → Next route → Phoenix /api/team.
//
// The slim org-roster endpoint powering the home "who's here" widget.
// No `users.view` requirement — any authed user can read it — so the
// proxy's only job is moving the httpOnly session cookie into a Bearer
// header. Same error-shape conventions as the /api/users proxy.
export async function GET() {
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

  try {
    const data = await api("/api/team", { token });
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

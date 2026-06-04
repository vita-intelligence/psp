import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

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
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/team",
      fallbackDetail: "Couldn't load the team roster.",
    });
    return NextResponse.json(payload, { status });
  }
}

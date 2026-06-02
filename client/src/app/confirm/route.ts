// Route handler at `/confirm` so the email link can set the session
// cookie and 302 to home in one round-trip. Pages can't set cookies
// during render in the Next App Router — route handlers can.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { api, ApiError } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import type { AuthResponse } from "@/lib/types";

const ONE_MONTH_SECONDS = 60 * 60 * 24 * 30;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const failUrl = new URL("/confirm/failed", req.nextUrl.origin);

  if (!token) {
    failUrl.searchParams.set("reason", "missing");
    return NextResponse.redirect(failUrl);
  }

  try {
    const res = await api<AuthResponse>("/api/auth/confirm", {
      method: "POST",
      body: JSON.stringify({ token }),
    });

    const store = await cookies();
    store.set(serverEnv.authCookieName, res.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ONE_MONTH_SECONDS,
    });

    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  } catch (err) {
    const reason = err instanceof ApiError ? "invalid" : "server_error";
    failUrl.searchParams.set("reason", reason);
    return NextResponse.redirect(failUrl);
  }
}

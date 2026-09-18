import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

// Same-origin proxy for the write-offs list + create. Every /api/*
// call on PSP goes through a Next.js route like this — the browser
// can't reach Phoenix directly because the session token lives in
// an HttpOnly cookie.

export async function GET(req: NextRequest) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Your session has expired. Please sign in again." },
      { status: 401 },
    );
  }

  const upstream = `/api/stock/write-offs${req.nextUrl.search ?? ""}`;

  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) await clearSessionCookie();
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/stock/write-offs",
      fallbackDetail: "Couldn't load stock write-offs.",
    });
    return NextResponse.json(payload, { status });
  }
}

export async function POST(req: NextRequest) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Your session has expired. Please sign in again." },
      { status: 401 },
    );
  }

  const body = await req.text();

  try {
    const data = await api(`/api/stock/write-offs`, {
      token,
      method: "POST",
      body,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) await clearSessionCookie();
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/stock/write-offs (create)",
      fallbackDetail: "Couldn't create the write-off.",
    });
    return NextResponse.json(payload, { status });
  }
}

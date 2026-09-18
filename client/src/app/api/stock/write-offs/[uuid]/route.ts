import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

// GET / PATCH / DELETE on a single write-off. Same session-cookie
// → bearer flow as the list route sibling.

async function forward(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
  init: RequestInit,
  source: string,
  fallback: string,
) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Your session has expired. Please sign in again." },
      { status: 401 },
    );
  }

  const { uuid } = await ctx.params;
  const upstream = `/api/stock/write-offs/${encodeURIComponent(uuid)}`;

  try {
    const data = await api(upstream, { token, ...init });
    return NextResponse.json(data ?? {});
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) await clearSessionCookie();
    const { payload, status } = toJsonError(err, { source, fallbackDetail: fallback });
    return NextResponse.json(payload, { status });
  }
}

export function GET(req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  return forward(
    req,
    ctx,
    {},
    "proxy:/api/stock/write-offs/:uuid",
    "Couldn't load the write-off.",
  );
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  const body = await req.text();
  return forward(
    req,
    ctx,
    { method: "PATCH", body },
    "proxy:/api/stock/write-offs/:uuid (patch)",
    "Couldn't update the write-off.",
  );
}

export function DELETE(req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  return forward(
    req,
    ctx,
    { method: "DELETE" },
    "proxy:/api/stock/write-offs/:uuid (delete)",
    "Couldn't delete the write-off.",
  );
}

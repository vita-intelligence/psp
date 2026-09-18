import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Your session has expired. Please sign in again." },
      { status: 401 },
    );
  }

  const { uuid } = await ctx.params;
  const body = await req.text();

  try {
    const data = await api(
      `/api/stock/write-offs/${encodeURIComponent(uuid)}/reject`,
      { token, method: "POST", body },
    );
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) await clearSessionCookie();
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/stock/write-offs/:uuid/reject",
      fallbackDetail: "Couldn't reject the write-off.",
    });
    return NextResponse.json(payload, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Same-origin proxy for one employee's reputation-event feed. Forwards
 * `limit` + `cursor` from the caller so the dedicated
 * `/hr/employees/:uuid/reputation` infinite-scroll page can walk the
 * keyset. Payload passes through unchanged
 * (`{ items, next_cursor }`).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Session expired." },
      { status: 401 },
    );
  }
  const { uuid } = await params;
  const search = req.nextUrl.search;
  const upstream = `/api/hr/employees/${encodeURIComponent(
    uuid,
  )}/reputation-events${search}`;
  try {
    const data = await api(upstream, { token, cache: "no-store" });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/hr/employees/[uuid]/reputation-events",
      fallbackDetail: "Couldn't load reputation events.",
    });
    return NextResponse.json(payload, { status });
  }
}

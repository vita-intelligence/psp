import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Same-origin proxy for one employee's workstation-session feed. The
 * client card fetches this URL; we forward the session bearer to
 * Phoenix and pass the `{ sessions: [...] }` payload through. Mirrors
 * the shape of the parent `/api/hr/employees` proxy.
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
  )}/sessions${search}`;
  try {
    const data = await api(upstream, { token, cache: "no-store" });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/hr/employees/[uuid]/sessions",
      fallbackDetail: "Couldn't load employee sessions.",
    });
    return NextResponse.json(payload, { status });
  }
}

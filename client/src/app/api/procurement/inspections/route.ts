import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Same-origin proxy for the global inspections ledger feed. The
 * DataTable fetches this from the browser; we forward the session
 * bearer to Phoenix and pass the response straight through.
 */
export async function GET(req: NextRequest) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Session expired." },
      { status: 401 },
    );
  }
  const upstream = `/api/procurement/inspections${req.nextUrl.search ?? ""}`;
  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/procurement/inspections",
      fallbackDetail: "Couldn't load inspections.",
    });
    return NextResponse.json(payload, { status });
  }
}

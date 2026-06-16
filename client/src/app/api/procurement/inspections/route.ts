import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Same-origin proxy for the global inspections ledger feed. The
 * DataTable fetches this from the browser; we forward the session
 * bearer (or paired-device bearer when called from /m/inspections on
 * a tablet) to Phoenix and pass the response straight through.
 */
export async function GET(req: NextRequest) {
  const sessionToken = await getSessionToken();
  const deviceToken = sessionToken ? null : await getDeviceToken();
  const token = sessionToken ?? deviceToken;
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
    // Only clear the session cookie on 401 — never clobber the device
    // cookie here; the mobile shell owns its own revoke flow.
    if (err instanceof ApiError && err.status === 401 && sessionToken) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/procurement/inspections",
      fallbackDetail: "Couldn't load inspections.",
    });
    return NextResponse.json(payload, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Same-origin proxy for the "Add a booking" lot picker. Returns the
 * lots eligible for a given (mo, item) with live available_qty.
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
  const upstream = `/api/production/manufacturing-orders/${encodeURIComponent(uuid)}/bookable-lots${req.nextUrl.search ?? ""}`;
  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/production/manufacturing-orders/[uuid]/bookable-lots",
      fallbackDetail: "Couldn't load lots for booking.",
    });
    return NextResponse.json(payload, { status });
  }
}

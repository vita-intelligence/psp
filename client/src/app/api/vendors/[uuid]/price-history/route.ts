import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Paginated + searchable passthrough to Phoenix's
 * ``GET /api/vendors/:uuid/price-history`` endpoint. The vendor
 * detail page's price-history card calls this on every search
 * keystroke and page change.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
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

  const { uuid } = await params;
  const upstream = `/api/vendors/${encodeURIComponent(uuid)}/price-history${
    req.nextUrl.search ?? ""
  }`;

  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/vendors/[uuid]/price-history",
      fallbackDetail: "Couldn't load price history.",
    });
    return NextResponse.json(payload, { status });
  }
}

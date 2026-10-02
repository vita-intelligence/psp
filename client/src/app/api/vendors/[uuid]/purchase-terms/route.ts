import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Paginated + searchable passthrough to Phoenix's
 * ``GET /api/vendors/:uuid/purchase-terms`` endpoint. The vendor
 * detail page's purchase-terms card calls this on every search
 * keystroke and "Load more" click once the FE sends pagination
 * params; Phoenix returns the paginated shape in that case.
 *
 * No params = legacy flat shape (``{purchase_terms: [...]}``) —
 * server actions that server-side render the vendor page still
 * work unchanged.
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
  const upstream = `/api/vendors/${encodeURIComponent(uuid)}/purchase-terms${
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
      source: "proxy:/api/vendors/[uuid]/purchase-terms",
      fallbackDetail: "Couldn't load purchase terms.",
    });
    return NextResponse.json(payload, { status });
  }
}

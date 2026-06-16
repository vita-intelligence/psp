import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Same-origin proxy for a single item — used by client surfaces that
 * need the full item payload (stock_uom + product_family + storage
 * tags) after a picker resolved a uuid. Server-rendered pages call
 * `getItem()` directly against Phoenix instead.
 */
export async function GET(
  _req: NextRequest,
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
  try {
    const data = await api(`/api/items/${encodeURIComponent(uuid)}`, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/items/[uuid]",
      fallbackDetail: "Couldn't load this item.",
    });
    return NextResponse.json(payload, { status });
  }
}

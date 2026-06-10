import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";

/**
 * Note on the param name: the parent dynamic segment is `[uuid]` because
 * sibling routes (`/api/items/[uuid]/images`, etc) already use that
 * slug, and Next.js requires the segment name to be consistent across
 * siblings. The receive form passes the item's integer `id` here — the
 * backend `Stock.packaging_suggestions/2` looks up by id regardless.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid: itemKey } = await params;
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const data = await api(
      `/api/stock/items/${encodeURIComponent(itemKey)}/packaging-suggestions`,
      { token, cache: "no-store" },
    );
    return NextResponse.json(data);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    return NextResponse.json({ error: "lookup_failed" }, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/** Same-origin proxy for the 'merge into batch' picker. */
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
  const upstream = `/api/production/manufacturing-orders/${encodeURIComponent(uuid)}/merge-candidates`;
  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/production/manufacturing-orders/[uuid]/merge-candidates",
      fallbackDetail: "Couldn't load merge candidates.",
    });
    return NextResponse.json(payload, { status });
  }
}

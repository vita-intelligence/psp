import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { clearSessionCookie, getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Same-origin proxy so client-side polling / manual refetches don't
 * need to know the backend origin. Mirrors the wizard proxy pattern
 * at `../wizard/route.ts`.
 */
export async function GET(
  _req: Request,
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

  try {
    const data = await api(
      `/api/customer-orders/${encodeURIComponent(uuid)}/cost-breakdown`,
      { token },
    );
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: `proxy:/api/customer-orders/${uuid}/cost-breakdown`,
      fallbackDetail: "Couldn't load the project cost breakdown.",
    });
    return NextResponse.json(payload, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Proxy: GET /api/m/pickup/production-feed-cells → Phoenix.
 * Returns empty production-feed cells for the confirm-transfer
 * auto-pick. When mo_uuid is supplied, Phoenix decorates each cell
 * with a `fit` object (dimensional pre-flight check for the whole
 * pickup load) — forward the query string so that info reaches the
 * mobile picker. Without this forward, Phoenix hits its no-mo_uuid
 * fallback and returns bare cells (fit: null), and the FE loses the
 * pre-flight fit banner it added specifically to catch \"cell too
 * small\" BEFORE the operator walks with the trolley.
 */
export async function GET(req: NextRequest) {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Device isn't signed in." },
      { status: 401 },
    );
  }

  const search = req.nextUrl.searchParams.toString();
  const upstream =
    "/api/m/pickup/production-feed-cells" + (search ? `?${search}` : "");

  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/m/pickup/production-feed-cells",
      fallbackDetail: "Couldn't load production-feed cells.",
    });
    return NextResponse.json(payload, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Proxy: GET /api/m/pickup/production-feed-cells → Phoenix.
 * Returns empty production-feed cells for the confirm-transfer
 * auto-pick.
 */
export async function GET(_req: NextRequest) {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Device isn't signed in." },
      { status: 401 },
    );
  }

  try {
    const data = await api("/api/m/pickup/production-feed-cells", { token });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/m/pickup/production-feed-cells",
      fallbackDetail: "Couldn't load production-feed cells.",
    });
    return NextResponse.json(payload, { status });
  }
}

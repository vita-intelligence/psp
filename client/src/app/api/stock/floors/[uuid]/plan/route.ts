import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";

/**
 * Proxy for the floor-plan widget. Accepts either the laptop session
 * cookie (desktop lot detail + equipment move dialog) or the paired
 * device cookie (mobile scan flow) so a single API path works on
 * both surfaces. The mobile-only ``/api/m/floors/...`` proxy is kept
 * for legacy callers.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params;
  const token = (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const data = await api(
      `/api/stock/floors/${encodeURIComponent(uuid)}/plan`,
      { token },
    );
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}

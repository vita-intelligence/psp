import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Proxy: GET /api/m/pickup/[mo_uuid] → Phoenix. Used by the pickup
 * detail page for client-side refresh while the picker is mid-flow.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ mo_uuid: string }> },
) {
  const { mo_uuid } = await params;
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Device isn't signed in." },
      { status: 401 },
    );
  }

  try {
    const data = await api(`/api/m/pickup/${encodeURIComponent(mo_uuid)}`, {
      token,
    });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/m/pickup/[mo_uuid]",
      fallbackDetail: "Couldn't load pickup detail.",
    });
    return NextResponse.json(payload, { status });
  }
}

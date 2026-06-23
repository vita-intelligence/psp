import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pick_uuid: string }> },
) {
  const { pick_uuid } = await params;
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Pair your device first." },
      { status: 401 },
    );
  }
  try {
    const data = await api(
      `/api/m/return-pickup/picks/${encodeURIComponent(pick_uuid)}/recommendations`,
      { token },
    );
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/m/return-pickup/picks/[uuid]/recommendations",
      fallbackDetail: "Couldn't load rack suggestions.",
    });
    return NextResponse.json(payload, { status });
  }
}

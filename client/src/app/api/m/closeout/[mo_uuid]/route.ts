import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ mo_uuid: string }> },
) {
  const { mo_uuid } = await params;
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Pair your device first." },
      { status: 401 },
    );
  }
  try {
    const data = await api(`/api/m/closeout/${encodeURIComponent(mo_uuid)}`, {
      token,
    });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/m/closeout/[mo_uuid]",
      fallbackDetail: "Couldn't load the closeout detail.",
    });
    return NextResponse.json(payload, { status });
  }
}

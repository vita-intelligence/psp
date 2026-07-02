import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

interface Ctx {
  params: Promise<{ lot_uuid: string }>;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { lot_uuid: lotUuid } = await params;
  const token = (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }

  try {
    const data = await api(
      `/api/production/final-releases/by-lot/${encodeURIComponent(lotUuid)}`,
      { token },
    );
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/production/final-releases/by-lot",
      fallbackDetail: "Couldn't load the release row.",
    });
    return NextResponse.json(payload, { status });
  }
}

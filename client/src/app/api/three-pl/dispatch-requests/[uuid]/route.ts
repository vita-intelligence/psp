import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { toJsonError } from "@/lib/errors/server";

interface Ctx {
  params: Promise<{ uuid: string }>;
}

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

export async function GET(_req: Request, { params }: Ctx) {
  const { uuid } = await params;
  const t = await token();
  if (!t) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }

  try {
    const data = await api(
      `/api/three-pl/dispatch-requests/${encodeURIComponent(uuid)}`,
      { token: t },
    );
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/three-pl/dispatch-requests/[uuid] GET",
      fallbackDetail: "Couldn't load the dispatch.",
    });
    return NextResponse.json(payload, { status });
  }
}

import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { toJsonError } from "@/lib/errors/server";

interface Ctx {
  params: Promise<{ uuid: string }>;
}

export async function POST(req: Request, { params }: Ctx) {
  const { uuid } = await params;
  const t = (await getSessionToken()) ?? (await getDeviceToken());
  if (!t) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }

  try {
    const body = (await req.json()) as {
      to_cell_uuid?: string;
      photo_url?: string;
    };
    const data = await api(
      `/api/three-pl/dispatch-requests/${encodeURIComponent(uuid)}/complete`,
      { method: "POST", token: t, body: JSON.stringify(body) },
    );
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/three-pl/dispatch-requests/complete",
      fallbackDetail: "Couldn't complete the dispatch.",
    });
    return NextResponse.json(payload, { status });
  }
}

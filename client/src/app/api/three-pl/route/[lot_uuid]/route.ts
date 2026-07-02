import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

interface Ctx {
  params: Promise<{ lot_uuid: string }>;
}

export async function POST(req: Request, { params }: Ctx) {
  const { lot_uuid: lotUuid } = await params;
  const token = (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }

  try {
    const body = (await req.json()) as {
      choice?: string;
      customer_uuid?: string;
    };
    const data = await api(
      `/api/three-pl/route/${encodeURIComponent(lotUuid)}`,
      {
        method: "POST",
        token,
        body: JSON.stringify({
          choice: body.choice,
          customer_uuid: body.customer_uuid,
        }),
      },
    );
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/three-pl/route",
      fallbackDetail: "Couldn't record the routing decision.",
    });
    return NextResponse.json(payload, { status });
  }
}

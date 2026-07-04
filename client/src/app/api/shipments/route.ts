import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { toJsonError } from "@/lib/errors/server";

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

export async function POST(req: Request) {
  const t = await token();
  if (!t) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }

  try {
    const body = (await req.json()) as { lot_uuid?: string };
    const data = await api("/api/shipments", {
      method: "POST",
      token: t,
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/shipments POST",
      fallbackDetail: "Couldn't create the shipment.",
    });
    return NextResponse.json(payload, { status });
  }
}

export async function GET(req: Request) {
  const t = await token();
  if (!t) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }

  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const path = qs.length > 0 ? `/api/shipments?${qs}` : "/api/shipments";
    const data = await api(path, { token: t });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/shipments GET",
      fallbackDetail: "Couldn't load shipments.",
    });
    return NextResponse.json(payload, { status });
  }
}

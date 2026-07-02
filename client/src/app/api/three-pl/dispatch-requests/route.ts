import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";
import { getDeviceToken } from "@/lib/devices/server";
import { toJsonError } from "@/lib/errors/server";

async function token(): Promise<string | null> {
  return (await getSessionToken()) ?? (await getDeviceToken());
}

/** Desktop POST + mobile-picker-queue GET share the same collection
 *  route so the desktop dispatch dialog and the /m queue both go
 *  through one file. */

export async function POST(req: Request) {
  const t = await token();
  if (!t) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }

  try {
    const body = (await req.json()) as {
      lot_uuid?: string;
      qty?: string;
      reference?: string | null;
      notes?: string | null;
    };
    const data = await api("/api/three-pl/dispatch-requests", {
      method: "POST",
      token: t,
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/three-pl/dispatch-requests POST",
      fallbackDetail: "Couldn't queue the dispatch.",
    });
    return NextResponse.json(payload, { status });
  }
}

export async function GET() {
  const t = await token();
  if (!t) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }

  try {
    const data = await api("/api/three-pl/dispatch-requests", { token: t });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/three-pl/dispatch-requests GET",
      fallbackDetail: "Couldn't load pending dispatches.",
    });
    return NextResponse.json(payload, { status });
  }
}

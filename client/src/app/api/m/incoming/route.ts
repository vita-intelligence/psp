import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Proxy: tablet browser → Next route → Phoenix /api/m/incoming.
 *
 * The mobile shell never holds a token in the JS heap — both the
 * device bearer and the session bearer are httpOnly cookies. This
 * proxy attaches whichever one is set (device first, session as
 * laptop dev-fallback) and forwards the query string verbatim so the
 * `?warehouse_id=` filter the client component appends reaches the
 * backend unchanged.
 */
export async function GET(req: NextRequest) {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return NextResponse.json(
      {
        error: "unauthorized",
        detail: "Pair your device to view incoming deliveries.",
      },
      { status: 401 },
    );
  }

  const upstream = `/api/m/incoming${req.nextUrl.search ?? ""}`;

  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/m/incoming",
      fallbackDetail: "Couldn't load the expected deliveries list.",
    });
    return NextResponse.json(payload, { status });
  }
}

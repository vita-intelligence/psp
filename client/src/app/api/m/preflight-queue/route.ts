import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Proxy: tablet / laptop browser → Next route → Phoenix
 * /api/m/preflight-queue. Device token first, session token fallback
 * — mirrors /api/m/pickup-queue.
 */
export async function GET(_req: NextRequest) {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return NextResponse.json(
      {
        error: "unauthorized",
        detail: "Pair your device to view the preflight queue.",
      },
      { status: 401 },
    );
  }

  try {
    const data = await api("/api/m/preflight-queue", { token });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/m/preflight-queue",
      fallbackDetail: "Couldn't load the preflight queue.",
    });
    return NextResponse.json(payload, { status });
  }
}

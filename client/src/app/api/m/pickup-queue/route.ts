import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/**
 * Proxy: tablet browser → Next route → Phoenix /api/m/pickup-queue.
 * Mirrors the /api/m/incoming proxy — device-token first, session
 * fallback. Both are httpOnly cookies (no token leaks to JS).
 */
export async function GET(_req: NextRequest) {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return NextResponse.json(
      {
        error: "unauthorized",
        detail: "Pair your device to view the pickup queue.",
      },
      { status: 401 },
    );
  }

  try {
    const data = await api("/api/m/pickup-queue", { token });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/m/pickup-queue",
      fallbackDetail: "Couldn't load the pickup queue.",
    });
    return NextResponse.json(payload, { status });
  }
}

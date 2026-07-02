import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

export async function GET() {
  const token = (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in to view the release queue." },
      { status: 401 },
    );
  }

  try {
    const data = await api(`/api/production/final-releases/queue`, { token });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/production/final-releases/queue",
      fallbackDetail: "Couldn't load the release queue.",
    });
    return NextResponse.json(payload, { status });
  }
}

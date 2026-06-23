import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

export async function GET() {
  const token = (await getDeviceToken()) ?? (await getSessionToken());
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Pair your device first." },
      { status: 401 },
    );
  }
  try {
    const data = await api("/api/m/return-pickup/loose", { token });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/m/return-pickup/loose",
      fallbackDetail: "Couldn't load the loose dispatch lots.",
    });
    return NextResponse.json(payload, { status });
  }
}

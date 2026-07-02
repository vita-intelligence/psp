import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getDeviceToken } from "@/lib/devices/server";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

export async function GET(req: NextRequest) {
  const token = (await getSessionToken()) ?? (await getDeviceToken());
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in to view the release queue." },
      { status: 401 },
    );
  }

  // Forward the DataTable params (status filter / limit / cursor /
  // search). The BE keeps unknown or blank params inert, so passing
  // through the whole querystring is safe.
  const search = req.nextUrl.searchParams.toString();
  const upstream =
    "/api/production/final-releases/queue" + (search ? `?${search}` : "");

  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/production/final-releases/queue",
      fallbackDetail: "Couldn't load the release queue.",
    });
    return NextResponse.json(payload, { status });
  }
}

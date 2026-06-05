import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

export async function GET(req: NextRequest) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Your session has expired." },
      { status: 401 },
    );
  }

  const upstream = `/api/queues/certificates-expiring${req.nextUrl.search ?? ""}`;

  try {
    const data = await api(upstream, { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/queues/certificates-expiring",
      fallbackDetail: "Couldn't load the expiring-certificates queue.",
    });
    return NextResponse.json(payload, { status });
  }
}

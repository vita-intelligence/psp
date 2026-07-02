import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

interface Ctx {
  params: Promise<{ uuid: string }>;
}

export async function POST(_req: Request, { params }: Ctx) {
  const { uuid } = await params;
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }

  try {
    const data = await api(
      `/api/three-pl/dispatch-requests/${encodeURIComponent(uuid)}/cancel`,
      { method: "POST", token, body: JSON.stringify({}) },
    );
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/three-pl/dispatch-requests/cancel",
      fallbackDetail: "Couldn't cancel the dispatch.",
    });
    return NextResponse.json(payload, { status });
  }
}

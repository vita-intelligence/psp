import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

interface Ctx {
  params: Promise<{ warehouse_id: string }>;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { warehouse_id: warehouseId } = await params;
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in." },
      { status: 401 },
    );
  }

  try {
    const data = await api(
      `/api/three-pl/capacity/${encodeURIComponent(warehouseId)}`,
      { token },
    );
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/three-pl/capacity",
      fallbackDetail: "Couldn't load 3PL capacity.",
    });
    return NextResponse.json(payload, { status });
  }
}

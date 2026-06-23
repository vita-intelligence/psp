import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

export async function GET(req: Request) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Sign in first." },
      { status: 401 },
    );
  }
  try {
    const url = new URL(req.url);
    const data = await api(
      `/api/procurement/shortages${url.search || ""}`,
      { token },
    );
    return NextResponse.json(data);
  } catch (err) {
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/procurement/shortages",
      fallbackDetail: "Couldn't load the shortages list.",
    });
    return NextResponse.json(payload, { status });
  }
}

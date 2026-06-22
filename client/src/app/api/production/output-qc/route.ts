import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken, clearSessionCookie } from "@/lib/auth/server";
import { toJsonError } from "@/lib/errors/server";

/** Same-origin proxy for the production output-QC queue feed. */
export async function GET() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Session expired." },
      { status: 401 },
    );
  }
  try {
    const data = await api("/api/production/output-qc", { token });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    const { payload, status } = toJsonError(err, {
      source: "proxy:/api/production/output-qc",
      fallbackDetail: "Couldn't load the output-QC queue.",
    });
    return NextResponse.json(payload, { status });
  }
}

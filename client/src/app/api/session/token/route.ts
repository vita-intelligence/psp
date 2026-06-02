import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/auth/server";

// Same-origin only: middleware already redirects unauthenticated users
// away from authed pages, so the WebSocket client can call this to
// pluck the bearer out of the httpOnly cookie. Never expose this URL
// to a non-same-origin caller.

export async function GET() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ token });
}

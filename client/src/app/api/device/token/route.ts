import { NextResponse } from "next/server";
import { getDeviceToken } from "@/lib/devices/server";

// Same-origin only: the /m mobile shell uses this to pluck the
// httpOnly device bearer out and connect to Phoenix Channels with
// `?device_token=<bearer>`. Never expose this URL to a non-same-origin
// caller.

export async function GET() {
  const token = await getDeviceToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ token });
}

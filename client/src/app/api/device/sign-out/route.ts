import { NextResponse } from "next/server";
import { clearDeviceCookies } from "@/lib/devices/server";

// Mobile "sign out this device" — clears the device cookies so the
// next /m visit redirects back to /pair. Doesn't revoke the row on
// the server (the user might pair again immediately); for full revoke
// the user goes to /settings/devices on their laptop.

export async function POST() {
  await clearDeviceCookies();
  return NextResponse.json({ ok: true });
}

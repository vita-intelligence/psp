import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import type { DeviceDisplay } from "@/lib/devices/server";
import { serverEnv } from "@/lib/env";
import type { DeviceClaimResponse, User } from "@/lib/types";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Mobile pairing endpoint. Called from the `/pair` form via `fetch()`
 * (not a Server Action and not a classic form POST) for two reasons:
 *
 *   1. iOS Safari shows a "Information you're about to send is not
 *      secured" interstitial on HTTP form submits to LAN dev servers;
 *      `fetch()` doesn't trigger it.
 *   2. Next.js Server Actions over plain-HTTP LAN drop Set-Cookie on
 *      Safari because the response uses the `x-action-…` protocol
 *      that Safari treats like an XHR, not a navigation. A Route
 *      Handler is just a regular HTTP response — Safari persists the
 *      cookie correctly.
 *
 * Cookies are set on the `NextResponse` object directly (not via the
 * buffered `cookies()` helper from `next/headers`) because the latter
 * sometimes drops writes in Turbopack dev — the explicit-on-response
 * pattern is the documented-reliable path.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const code = String(form.get("code") || "").trim().toUpperCase();
  const label = String(form.get("label") || "").trim() || "Mobile device";
  const platform = String(form.get("platform") || "").trim() || null;

  if (!code) {
    return NextResponse.json(
      { ok: false, detail: "Missing pairing code." },
      { status: 400 },
    );
  }

  try {
    const res = await api<DeviceClaimResponse & { user?: User }>(
      "/api/devices/claim",
      {
        method: "POST",
        body: JSON.stringify({
          code,
          label,
          platform,
        }),
        headers: {
          "user-agent": req.headers.get("user-agent") || "unknown",
        },
      },
    );

    if (!res.user) {
      return NextResponse.json(
        { ok: false, detail: "Paired, but couldn't load your user." },
        { status: 502 },
      );
    }

    const response = NextResponse.json({ ok: true, redirect: "/m" });
    const secure = process.env.NODE_ENV === "production";

    response.cookies.set(serverEnv.deviceCookieName, res.token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
    });

    // Display cookie kept deliberately tiny — Safari drops cookies
    // over ~4KB and the full User payload with permissions/avatar
    // blows past that. Only ship what /m actually renders.
    const display: DeviceDisplay = {
      user_name: res.user.name || res.user.email,
      user_email: res.user.email,
      user_uuid: res.user.uuid,
      device_uuid: res.device.uuid,
      device_label: res.device.label,
    };

    response.cookies.set(
      serverEnv.deviceUserCookieName,
      JSON.stringify(display),
      {
        httpOnly: false,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: ONE_YEAR_SECONDS,
      },
    );

    return response;
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { ok: false, detail: err.detail || "Couldn't claim that code." },
        { status: err.status || 422 },
      );
    }
    return NextResponse.json(
      { ok: false, detail: "Network error talking to the server." },
      { status: 500 },
    );
  }
}

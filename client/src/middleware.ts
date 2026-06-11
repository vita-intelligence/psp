// Edge middleware — runs before every request matching the matcher
// below. Cheap cookie-presence check only; we don't verify the token
// here (that would mean a backend round-trip on every navigation).
// Real verification happens in the layout/page via `requireUser()`,
// which calls /api/auth/me; the middleware just short-circuits the
// obvious "not logged in" case so we don't render an authed shell for
// no one.

import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "psp_session";
const DEVICE_COOKIE_NAME = process.env.DEVICE_COOKIE_NAME || "psp_device";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/confirm",
  "/confirm/failed",
  "/forgot-password",
  "/reset-password",
  // Mobile pairing entry — anyone with a one-time code can land here.
  "/pair",
];

// Routes that authenticate via the *device* cookie instead of the
// session cookie. The phone never logs in as a session — it's only
// paired — so /m and any future mobile-only routes accept whichever
// cookie is present.
const DEVICE_PATHS = ["/m"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // API routes self-authenticate (proxy handlers read `getSessionToken`
  // / `getDeviceToken` themselves and return 401 when missing). The
  // pairing endpoint in particular MUST be reachable from a phone with
  // no cookies at all — that's the request that sets the device cookie.
  // Bouncing it to /login is what was causing the "Network error" loop.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const hasSession = req.cookies.has(COOKIE_NAME);
  const hasDevice = req.cookies.has(DEVICE_COOKIE_NAME);
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isDeviceRoute = DEVICE_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // Device routes accept either the device cookie OR a normal session
  // cookie. Goods-in operators use the paired tablet; QC + admins use
  // their desk laptop to approve from /m/inspections/... — the page
  // server-components verify the active actor and the BE still gates
  // every action by RBAC. With neither token, send them to /pair.
  if (isDeviceRoute) {
    if (!hasDevice && !hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = "/pair";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Mobile lock: once a device is paired (device cookie present and
  // NO laptop session on this browser), the only screens it can reach
  // are the mobile shell and the pairing flow. Hitting / or /settings
  // from a paired phone redirects to /m so operators never accidentally
  // land in the desktop UI on a small screen.
  if (hasDevice && !hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/m";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Already-authed users bouncing off /login or /register → home.
  // /confirm and /pair are exempt: /confirm is reached from an email
  // link by a logged-in user, /pair is reached from a QR scan that
  // may be on a brand-new browser regardless of session state.
  const skipAlreadyAuthedBounce =
    pathname === "/confirm" || pathname === "/pair" || pathname.startsWith("/pair/");

  if (hasSession && isPublic && !skipAlreadyAuthedBounce) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals and static files; everything else routes
  // through here so unauthenticated users can't peek at any app page.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};

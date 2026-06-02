// Edge middleware — runs before every request matching the matcher
// below. Cheap cookie-presence check only; we don't verify the token
// here (that would mean a backend round-trip on every navigation).
// Real verification happens in the layout/page via `requireUser()`,
// which calls /api/auth/me; the middleware just short-circuits the
// obvious "not logged in" case so we don't render an authed shell for
// no one.

import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "psp_session";

const PUBLIC_PATHS = ["/login", "/register", "/confirm", "/confirm/failed"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(COOKIE_NAME);
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Already-authed users bouncing off /login or /register → home.
  if (hasSession && isPublic && pathname !== "/confirm") {
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

import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/server";

/**
 * Clear the session cookie and bounce to /login. Used as the redirect
 * target whenever a server component detects a stale or invalid
 * session — because cookies can't be mutated from server components,
 * we need a route handler in the middle to actually clear it.
 *
 * Both GET and POST are accepted: GET so server-component redirects
 * land here cleanly, POST so an explicit "sign out" form button can
 * also use it.
 */
async function handler(req: NextRequest) {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/login", req.nextUrl.origin), 302);
}

export { handler as GET, handler as POST };

// Server-only auth helpers. Stores the bearer token in an httpOnly,
// SameSite=Lax cookie so the browser can't read it via JS (XSS-safe)
// but still sends it with same-site fetches. The token itself is a
// signed Phoenix.Token from the backend — verified against the backend
// secret on every request.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "../api";
import { serverEnv } from "../env";
import type { User } from "../types";

const ONE_MONTH_SECONDS = 60 * 60 * 24 * 30;

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(serverEnv.authCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_MONTH_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(serverEnv.authCookieName);
}

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(serverEnv.authCookieName)?.value ?? null;
}

/**
 * Reads the session cookie, verifies it against the backend, returns
 * the user or `null`.
 *
 * NOTE: we deliberately don't clear a stale cookie here even when we
 * get a 401 — `cookies().delete()` is forbidden in server components,
 * and this helper is called from page render. A stale cookie is
 * harmless (the middleware lets it through, `requireUser` redirects to
 * /login, and a fresh login overwrites it). The proxy route handler
 * at `/api/users` does clear it on 401, which is the path that runs
 * after the user is interactively past the auth gate.
 */
export async function getCurrentUser(): Promise<User | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { user } = await api<{ user: User }>("/api/auth/me", { token });
    return user;
  } catch {
    return null;
  }
}

/**
 * Convenience for protected pages — redirects on missing or invalid
 * session.
 *
 * If there's NO cookie at all, sends straight to `/login` (middleware
 * would do the same; this saves a hop). If there's a stale cookie,
 * goes through `/api/auth/sign-out` so the cookie actually gets
 * cleared (server components can't delete cookies themselves — would
 * otherwise cause a `/` → `/login` → middleware-bounces-back-to-/`
 * redirect loop on the next page load).
 */
export async function requireUser(): Promise<User> {
  const token = await getSessionToken();
  if (!token) redirect("/login");

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/sign-out");

  return user;
}

// Action implementations (loginAction / registerAction / logoutAction)
// live in ./actions.ts so they can be invoked from client components
// via the "use server" directive.

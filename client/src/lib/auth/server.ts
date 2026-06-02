// Server-only auth helpers. Stores the bearer token in an httpOnly,
// SameSite=Lax cookie so the browser can't read it via JS (XSS-safe)
// but still sends it with same-site fetches. The token itself is a
// signed Phoenix.Token from the backend — verified against the backend
// secret on every request.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api, ApiError } from "../api";
import { serverEnv } from "../env";
import type { User, AuthResponse } from "../types";

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
 * the user or `null` (with the cookie cleared if it was stale).
 */
export async function getCurrentUser(): Promise<User | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { user } = await api<{ user: User }>("/api/auth/me", { token });
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSessionCookie();
    }
    return null;
  }
}

/**
 * Convenience for protected pages — redirects to /login on missing
 * or invalid session.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function loginAction(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const res = await api<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  await setSessionCookie(res.token);
  return res;
}

export async function registerAction(
  email: string,
  name: string,
  password: string,
): Promise<AuthResponse> {
  const res = await api<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, name, password }),
  });
  await setSessionCookie(res.token);
  return res;
}

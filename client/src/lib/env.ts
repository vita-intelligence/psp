// Centralised env access. Keeps `process.env.*` lookups out of the
// rest of the codebase so we have exactly one place to add validation
// later. Public values are exposed via `NEXT_PUBLIC_*`; everything
// else is server-only.

export const env = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
  wsUrl: process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4000/socket",
} as const;

export const serverEnv = {
  authCookieName: process.env.AUTH_COOKIE_NAME || "psp_session",
} as const;

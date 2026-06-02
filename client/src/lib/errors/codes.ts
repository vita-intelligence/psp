// Friendly UI strings keyed by backend error code. Lets us swap copy
// without redeploying the backend, and gives us a fallback when the
// backend's `detail` string is too technical or missing.

import type { ApiErrorCode } from "./types";

const MESSAGES: Record<ApiErrorCode, string> = {
  validation_failed: "Please correct the highlighted fields.",
  invalid_credentials: "That email and password combination didn't work.",
  email_not_confirmed:
    "Your email isn't confirmed yet — check your inbox for the link.",
  email_and_password_required: "Both email and password are required.",
  invalid_or_expired_token:
    "This link is no longer valid. It may have already been used.",
  token_required: "A confirmation token is required.",
  unauthorized: "Your session has expired. Please sign in again.",
  forbidden: "You don't have permission to do that.",
  not_found: "We couldn't find what you're looking for.",
  network_error:
    "Can't reach the server. Check your connection and try again.",
  server_error: "Something went wrong on our end. Please try again.",
  rate_limited: "You're going too fast. Please wait a moment and retry.",
  unknown: "Something went wrong. Please try again.",
};

/**
 * Resolve an error code to a UI string. Prefers the backend's `detail`
 * field (server-side copy is usually more specific) and falls back to
 * the lookup table.
 */
export function messageFor(
  code: string | undefined,
  detail: string | undefined,
): string {
  if (detail && detail.trim().length > 0) return detail;
  const key = (code as ApiErrorCode) || "unknown";
  return MESSAGES[key] ?? MESSAGES.unknown;
}

export function isKnownCode(code: string): code is ApiErrorCode {
  return code in MESSAGES;
}

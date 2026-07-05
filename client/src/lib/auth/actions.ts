"use server";

import { redirect } from "next/navigation";
import { api } from "../api";
import { setSessionCookie, clearSessionCookie } from "./server";
import type { AuthResponse } from "../types";
import {
  toErrorResult,
  syntheticErrorResult,
  type ErrorResult,
} from "../errors/server";

// NOTE: "use server" files may only export async functions. Type
// re-exports (`export type { ErrorResult }`) break the build because
// Next tries to register them as actions and fails on the missing
// runtime value. Keep types out of this file's exported surface —
// consumers import `ErrorResult` directly from "@/lib/errors/server".
export type FieldErrors = Record<string, string[]>;
type ActionResult =
  | { ok: true }
  | { ok: true; mfa: { mfa_token: string } }
  | ErrorResult;
type RegisterResult = { ok: true; pending: true } | ErrorResult;
type MfaLoginResponse =
  | AuthResponse
  | { mfa_required: true; mfa_token: string };

export async function loginAction(formData: FormData): Promise<ActionResult> {
  const email = (formData.get("email") || "").toString().trim();
  const password = (formData.get("password") || "").toString();

  // Client-side check before round-tripping the network.
  const fields: FieldErrors = {};
  if (!email) fields.email = ["Email is required."];
  if (!password) fields.password = ["Password is required."];
  if (Object.keys(fields).length > 0) {
    return syntheticErrorResult({
      source: "loginAction",
      code: "validation_failed",
      detail: "Please fill in both fields.",
      fields,
      exception: "client-side guard: missing fields",
    });
  }

  let redirectHere = false;
  let mfaChallenge: string | null = null;

  try {
    const res = await api<MfaLoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if ("mfa_required" in res && res.mfa_required) {
      // Hand the mfa_token back to the caller — they'll POST it +
      // the TOTP code to /auth/mfa/verify via `verifyMfaAction`.
      mfaChallenge = res.mfa_token;
    } else if ("token" in res) {
      await setSessionCookie(res.token);
      redirectHere = true;
    }
  } catch (err) {
    return toErrorResult(err, { source: "loginAction" });
  }

  if (redirectHere) redirect("/");
  if (mfaChallenge) return { ok: true, mfa: { mfa_token: mfaChallenge } };

  return syntheticErrorResult({
    source: "loginAction",
    code: "unexpected_response",
    detail: "Login returned an unexpected shape. Try again.",
    exception: "server response missing both token and mfa_required",
  });
}

/**
 * Second step of MFA login. Exchanges the short-lived `mfa_token`
 * (from `loginAction`) plus a TOTP or recovery code for a full
 * session token, then redirects home.
 */
export async function verifyMfaAction(input: {
  mfa_token: string;
  code: string;
}): Promise<{ ok: true } | ErrorResult> {
  const code = input.code.trim();
  if (!code) {
    return syntheticErrorResult({
      source: "verifyMfaAction",
      code: "validation_failed",
      detail:
        "Enter the 6-digit code from your authenticator, or a recovery code.",
      fields: { code: ["Code is required."] },
      exception: "client-side guard: empty code",
    });
  }

  try {
    const res = await api<AuthResponse>("/api/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ mfa_token: input.mfa_token, code }),
    });
    await setSessionCookie(res.token);
  } catch (err) {
    return toErrorResult(err, { source: "verifyMfaAction" });
  }

  redirect("/");
}

export async function registerAction(
  formData: FormData,
): Promise<RegisterResult> {
  const email = (formData.get("email") || "").toString().trim();
  const name = (formData.get("name") || "").toString().trim();
  const password = (formData.get("password") || "").toString();

  const fields: FieldErrors = {};
  if (!name) fields.name = ["Full name is required."];
  if (!email) fields.email = ["Email is required."];
  if (!password) fields.password = ["Password is required."];
  else if (password.length < 8)
    fields.password = ["Password must be at least 8 characters."];
  if (Object.keys(fields).length > 0) {
    return syntheticErrorResult({
      source: "registerAction",
      code: "validation_failed",
      detail: "Please correct the highlighted fields.",
      fields,
      exception: "client-side guard: invalid registration form",
    });
  }

  try {
    await api<{ status: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, name, password }),
    });
    return { ok: true, pending: true };
  } catch (err) {
    return toErrorResult(err, { source: "registerAction" });
  }
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

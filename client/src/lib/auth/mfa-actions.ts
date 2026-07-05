"use server";

import { api } from "../api";
import { getSessionToken, setSessionCookie } from "./server";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";
import type { User } from "../types";

// Same "use server" constraint as `actions.ts` — only async
// functions may be exported. Types live in the caller's import site.
export type MfaStatus = {
  enrolled: boolean;
  confirmed_at: string | null;
  recovery_codes_remaining: number;
  required: boolean;
  grace_deadline: string | null;
};

type EnrollResponse = {
  secret: string;
  otpauth_uri: string;
};

type ConfirmResponse = {
  ok: true;
  recovery_codes: string[];
  token: string;
  user: User;
};

type DisableResponse = {
  ok: true;
  token: string;
  user: User;
};

export async function getMfaStatusAction(): Promise<MfaStatus | ErrorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("getMfaStatusAction");

  try {
    return await api<MfaStatus>("/api/auth/mfa/status", { token });
  } catch (err) {
    return toErrorResult(err, { source: "getMfaStatusAction" });
  }
}

export async function enrollMfaAction(): Promise<
  { ok: true; secret: string; otpauth_uri: string } | ErrorResult
> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("enrollMfaAction");

  try {
    const res = await api<EnrollResponse>("/api/auth/mfa/enroll", {
      method: "POST",
      token,
    });
    return { ok: true, secret: res.secret, otpauth_uri: res.otpauth_uri };
  } catch (err) {
    return toErrorResult(err, { source: "enrollMfaAction" });
  }
}

export async function confirmMfaAction(input: {
  code: string;
}): Promise<
  { ok: true; recovery_codes: string[] } | ErrorResult
> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("confirmMfaAction");

  try {
    const res = await api<ConfirmResponse>("/api/auth/mfa/confirm", {
      method: "POST",
      token,
      body: JSON.stringify({ code: input.code.trim() }),
    });
    // Confirmation bumps token_version — the server minted a fresh
    // one for us; swap the cookie so the current session survives.
    if (res.token) await setSessionCookie(res.token);
    return { ok: true, recovery_codes: res.recovery_codes };
  } catch (err) {
    return toErrorResult(err, { source: "confirmMfaAction" });
  }
}

export async function disableMfaAction(input: {
  current_password: string;
}): Promise<{ ok: true } | ErrorResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("disableMfaAction");

  try {
    const res = await api<DisableResponse>("/api/auth/mfa/disable", {
      method: "POST",
      token,
      body: JSON.stringify({ current_password: input.current_password }),
    });
    if (res.token) await setSessionCookie(res.token);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, { source: "disableMfaAction" });
  }
}

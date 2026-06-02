"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "../api";
import { getSessionToken, setSessionCookie } from "./server";
import type { AuthResponse, User } from "../types";
import type { ErrorResult } from "./actions";

export type ProfileResult = { ok: true; user: User } | ErrorResult;
export type PasswordResult = { ok: true } | ErrorResult;

function toErrorResult(err: unknown): ErrorResult {
  if (err instanceof ApiError) {
    return {
      ok: false,
      code: err.code,
      detail: err.detail,
      fields: err.fields,
    };
  }
  return {
    ok: false,
    code: "unknown",
    detail: "Something went wrong. Please try again.",
  };
}

export async function updateProfileAction(input: {
  name: string;
  avatar?: string | null;
}): Promise<ProfileResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, code: "unauthorized", detail: "Sign in first." };

  try {
    const res = await api<{ user: User }>("/api/auth/me", {
      method: "PUT",
      token,
      body: JSON.stringify(input),
    });
    // Repaint everything that depends on the user (top bar, home, etc.)
    revalidatePath("/", "layout");
    return { ok: true, user: res.user };
  } catch (err) {
    return toErrorResult(err);
  }
}

export async function changePasswordAction(input: {
  current_password: string;
  password: string;
}): Promise<PasswordResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, code: "unauthorized", detail: "Sign in first." };

  try {
    await api<{ ok: true }>("/api/auth/password", {
      method: "PUT",
      token,
      body: JSON.stringify(input),
    });
    return { ok: true };
  } catch (err) {
    return toErrorResult(err);
  }
}

export async function forgotPasswordAction(
  email: string,
): Promise<{ ok: true } | ErrorResult> {
  if (!email.trim()) {
    return {
      ok: false,
      code: "validation_failed",
      detail: "Please enter your email.",
      fields: { email: ["Email is required."] },
    };
  }

  try {
    await api("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: email.trim() }),
    });
    return { ok: true };
  } catch (err) {
    return toErrorResult(err);
  }
}

export async function resetPasswordAction(input: {
  token: string;
  password: string;
}): Promise<{ ok: true } | ErrorResult> {
  if (!input.token) {
    return {
      ok: false,
      code: "token_required",
      detail: "Reset link is missing its token.",
    };
  }
  if (!input.password || input.password.length < 8) {
    return {
      ok: false,
      code: "validation_failed",
      detail: "Please choose a stronger password.",
      fields: { password: ["Password must be at least 8 characters."] },
    };
  }

  try {
    const res = await api<AuthResponse>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(input),
    });
    await setSessionCookie(res.token);
  } catch (err) {
    return toErrorResult(err);
  }

  redirect("/");
}

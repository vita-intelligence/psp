"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "../api";
import { getSessionToken, setSessionCookie } from "./server";
import type { AuthResponse, User } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  syntheticErrorResult,
  type ErrorResult,
} from "../errors/server";

export type ProfileResult = { ok: true; user: User } | ErrorResult;
export type PasswordResult = { ok: true } | ErrorResult;

export async function updateProfileAction(input: {
  name: string;
  avatar?: string | null;
}): Promise<ProfileResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateProfileAction");

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
    return toErrorResult(err, {
      source: "updateProfileAction",
      fallbackDetail: "Couldn't save your profile.",
    });
  }
}

export async function changePasswordAction(input: {
  current_password: string;
  password: string;
}): Promise<PasswordResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("changePasswordAction");

  try {
    await api<{ ok: true }>("/api/auth/password", {
      method: "PUT",
      token,
      body: JSON.stringify(input),
    });
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "changePasswordAction",
      fallbackDetail: "Couldn't change your password.",
    });
  }
}

export async function forgotPasswordAction(
  email: string,
): Promise<{ ok: true } | ErrorResult> {
  if (!email.trim()) {
    return syntheticErrorResult({
      source: "forgotPasswordAction",
      code: "validation_failed",
      detail: "Please enter your email.",
      fields: { email: ["Email is required."] },
      exception: "client-side guard: empty email",
    });
  }

  try {
    await api("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: email.trim() }),
    });
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "forgotPasswordAction",
      fallbackDetail: "Couldn't send the reset link.",
    });
  }
}

export async function resetPasswordAction(input: {
  token: string;
  password: string;
}): Promise<{ ok: true } | ErrorResult> {
  if (!input.token) {
    return syntheticErrorResult({
      source: "resetPasswordAction",
      code: "token_required",
      detail: "Reset link is missing its token.",
      exception: "client-side guard: empty reset token",
    });
  }
  if (!input.password || input.password.length < 8) {
    return syntheticErrorResult({
      source: "resetPasswordAction",
      code: "validation_failed",
      detail: "Please choose a stronger password.",
      fields: { password: ["Password must be at least 8 characters."] },
      exception: "client-side guard: password too short",
    });
  }

  try {
    const res = await api<AuthResponse>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(input),
    });
    await setSessionCookie(res.token);
  } catch (err) {
    return toErrorResult(err, {
      source: "resetPasswordAction",
      fallbackDetail: "Couldn't reset your password.",
    });
  }

  redirect("/");
}

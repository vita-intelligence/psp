"use server";

import { redirect } from "next/navigation";
import { api, ApiError } from "../api";
import { setSessionCookie, clearSessionCookie } from "./server";
import type { AuthResponse } from "../types";

export type FieldErrors = Record<string, string[]>;

export interface ErrorResult {
  ok: false;
  code: string;
  detail: string;
  fields?: FieldErrors;
}

export type ActionResult = { ok: true } | ErrorResult;
export type RegisterResult = { ok: true; pending: true } | ErrorResult;

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

export async function loginAction(formData: FormData): Promise<ActionResult> {
  const email = (formData.get("email") || "").toString().trim();
  const password = (formData.get("password") || "").toString();

  // Client-side check before round-tripping the network.
  const fields: FieldErrors = {};
  if (!email) fields.email = ["Email is required."];
  if (!password) fields.password = ["Password is required."];
  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      code: "validation_failed",
      detail: "Please fill in both fields.",
      fields,
    };
  }

  try {
    const res = await api<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await setSessionCookie(res.token);
  } catch (err) {
    return toErrorResult(err);
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
    return {
      ok: false,
      code: "validation_failed",
      detail: "Please correct the highlighted fields.",
      fields,
    };
  }

  try {
    await api<{ status: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, name, password }),
    });
    return { ok: true, pending: true };
  } catch (err) {
    return toErrorResult(err);
  }
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

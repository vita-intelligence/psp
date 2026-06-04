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
type ActionResult = { ok: true } | ErrorResult;
type RegisterResult = { ok: true; pending: true } | ErrorResult;

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

  try {
    const res = await api<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await setSessionCookie(res.token);
  } catch (err) {
    return toErrorResult(err, { source: "loginAction" });
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

"use server";

import { redirect } from "next/navigation";
import { api, ApiError } from "../api";
import {
  setSessionCookie,
  clearSessionCookie,
} from "./server";
import type { AuthResponse } from "../types";

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type RegisterResult =
  | { ok: true; pending: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function loginAction(formData: FormData): Promise<ActionResult> {
  const email = (formData.get("email") || "").toString().trim();
  const password = (formData.get("password") || "").toString();

  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  try {
    const res = await api<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await setSessionCookie(res.token);
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      if (body?.error === "email_not_confirmed") {
        return {
          ok: false,
          error:
            "Your email isn't confirmed yet. Check your inbox for the confirmation link.",
        };
      }
      return { ok: false, error: "Invalid email or password." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  redirect("/");
}

export async function registerAction(
  formData: FormData,
): Promise<RegisterResult> {
  const email = (formData.get("email") || "").toString().trim();
  const name = (formData.get("name") || "").toString().trim();
  const password = (formData.get("password") || "").toString();

  if (!email || !name || !password) {
    return { ok: false, error: "All fields are required." };
  }

  try {
    await api<{ status: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, name, password }),
    });
    return { ok: true, pending: true };
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as
        | { errors?: Record<string, string[]>; error?: string }
        | null;
      if (body?.errors) {
        const first =
          Object.values(body.errors).flat().find(Boolean) ??
          "Please check your details.";
        return {
          ok: false,
          error: String(first),
          fieldErrors: body.errors,
        };
      }
      return { ok: false, error: body?.error ?? "Registration failed." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function confirmAction(token: string): Promise<ActionResult> {
  try {
    const res = await api<AuthResponse>("/api/auth/confirm", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    await setSessionCookie(res.token);
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        ok: false,
        error: "This confirmation link is invalid or has already been used.",
      };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
import type { Company } from "../types";
import type { ErrorResult } from "../auth/actions";

export type CompanyResult = { ok: true; company: Company } | ErrorResult;

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

/**
 * Edit the Company identity card. Backend changeset is the source of
 * truth for validation — we just forward and surface field errors.
 */
export async function updateCompanyIdentityAction(
  input: Partial<Company>,
): Promise<CompanyResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, code: "unauthorized", detail: "Sign in first." };

  try {
    const res = await api<{ company: Company }>("/api/company", {
      method: "PUT",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath("/settings/company");
    return { ok: true, company: res.company };
  } catch (err) {
    return toErrorResult(err);
  }
}

export async function updateCompanyLocaleAction(
  input: Partial<Company>,
): Promise<CompanyResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, code: "unauthorized", detail: "Sign in first." };

  try {
    const res = await api<{ company: Company }>("/api/company/locale", {
      method: "PUT",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath("/settings/company");
    return { ok: true, company: res.company };
  } catch (err) {
    return toErrorResult(err);
  }
}

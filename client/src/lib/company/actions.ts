"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { Company } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type CompanyResult = { ok: true; company: Company } | ErrorResult;

/**
 * Edit the Company identity card. Backend changeset is the source of
 * truth for validation — we just forward and surface field errors.
 */
export async function updateCompanyIdentityAction(
  input: Partial<Company>,
): Promise<CompanyResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateCompanyIdentityAction");

  try {
    const res = await api<{ company: Company }>("/api/company", {
      method: "PUT",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath("/settings/company");
    return { ok: true, company: res.company };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateCompanyIdentityAction",
      fallbackDetail: "Couldn't save the company identity card.",
    });
  }
}

export async function updateCompanyLocaleAction(
  input: Partial<Company>,
): Promise<CompanyResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateCompanyLocaleAction");

  try {
    const res = await api<{ company: Company }>("/api/company/locale", {
      method: "PUT",
      token,
      body: JSON.stringify(input),
    });
    revalidatePath("/settings/company");
    return { ok: true, company: res.company };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateCompanyLocaleAction",
      fallbackDetail: "Couldn't save the locale settings.",
    });
  }
}

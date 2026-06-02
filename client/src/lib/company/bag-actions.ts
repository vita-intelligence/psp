"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "../api";
import { getSessionToken } from "../auth/server";
import type { Company } from "../types";
import type { ErrorResult } from "../auth/actions";

type BagField =
  | "working_hours"
  | "holidays"
  | "currency_rates"
  | "allowed_ips"
  | "numbering_formats";

export type BagResult = { ok: true; company: Company } | ErrorResult;

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
 * Replace the entire value at `field` atomically. Caller is
 * responsible for sending the full bag — partial updates are not
 * supported; merging happens client-side before this fires.
 */
export async function updateCompanyBagAction(
  field: BagField,
  value: unknown,
): Promise<BagResult> {
  const token = await getSessionToken();
  if (!token)
    return { ok: false, code: "unauthorized", detail: "Sign in first." };

  try {
    const res = await api<{ company: Company }>("/api/company/bag", {
      method: "PUT",
      token,
      body: JSON.stringify({ field, value }),
    });
    revalidatePath("/settings/company");
    return { ok: true, company: res.company };
  } catch (err) {
    return toErrorResult(err);
  }
}

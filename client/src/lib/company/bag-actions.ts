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

type BagField =
  | "working_hours"
  | "holidays"
  | "currency_rates"
  | "allowed_ips"
  | "numbering_formats";

export type BagResult = { ok: true; company: Company } | ErrorResult;

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
  if (!token) return unauthorizedResult(`updateCompanyBagAction:${field}`);

  try {
    const res = await api<{ company: Company }>("/api/company/bag", {
      method: "PUT",
      token,
      body: JSON.stringify({ field, value }),
    });
    revalidatePath("/settings/company");
    return { ok: true, company: res.company };
  } catch (err) {
    return toErrorResult(err, {
      source: `updateCompanyBagAction:${field}`,
      fallbackDetail: `Couldn't save the ${field.replace(/_/g, " ")} settings.`,
    });
  }
}

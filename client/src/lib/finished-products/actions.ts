"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { FinishedProductSpec } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type SpecResult =
  | { ok: true; finished_product_spec: FinishedProductSpec }
  | ErrorResult;

export async function upsertFinishedProductSpecAction(
  itemUuid: string,
  input: Partial<FinishedProductSpec>,
): Promise<SpecResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("upsertFinishedProductSpecAction");

  try {
    const res = await api<{ finished_product_spec: FinishedProductSpec }>(
      `/api/items/${itemUuid}/finished-product-spec`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/settings/items/${itemUuid}`);
    return { ok: true, finished_product_spec: res.finished_product_spec };
  } catch (err) {
    return toErrorResult(err, {
      source: "upsertFinishedProductSpecAction",
      fallbackDetail: "Couldn't save the finished-product specification.",
    });
  }
}

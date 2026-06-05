"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { PackagingCompliance } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type PackagingResult =
  | { ok: true; packaging_compliance: PackagingCompliance }
  | ErrorResult;

export async function upsertPackagingComplianceAction(
  itemUuid: string,
  input: Partial<PackagingCompliance>,
): Promise<PackagingResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("upsertPackagingComplianceAction");

  try {
    const res = await api<{ packaging_compliance: PackagingCompliance }>(
      `/api/items/${itemUuid}/packaging-compliance`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/settings/items/${itemUuid}`);
    return { ok: true, packaging_compliance: res.packaging_compliance };
  } catch (err) {
    return toErrorResult(err, {
      source: "upsertPackagingComplianceAction",
      fallbackDetail: "Couldn't save packaging compliance.",
    });
  }
}

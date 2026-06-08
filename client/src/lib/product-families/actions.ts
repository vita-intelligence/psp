"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { ProductFamily } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type FamilyResult =
  | { ok: true; family: ProductFamily }
  | ErrorResult;

export type DeleteResult = { ok: true } | ErrorResult;

interface FamilyInput {
  name?: string;
  description?: string | null;
  is_active?: boolean;
}

export async function createFamilyAction(
  input: FamilyInput,
): Promise<FamilyResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createFamilyAction");

  try {
    const res = await api<{ family: ProductFamily }>(
      `/api/product-families`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/settings/product-families`);
    return { ok: true, family: res.family };
  } catch (err) {
    return toErrorResult(err, {
      source: "createFamilyAction",
      fallbackDetail: "Couldn't create the family.",
    });
  }
}

export async function updateFamilyAction(
  uuid: string,
  input: FamilyInput,
): Promise<FamilyResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateFamilyAction");

  try {
    const res = await api<{ family: ProductFamily }>(
      `/api/product-families/${uuid}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/settings/product-families`);
    return { ok: true, family: res.family };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateFamilyAction",
      fallbackDetail: "Couldn't update the family.",
    });
  }
}

export async function deleteFamilyAction(
  uuid: string,
): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteFamilyAction");

  try {
    await api<void>(`/api/product-families/${uuid}`, {
      method: "DELETE",
      token,
    });
    revalidatePath(`/settings/product-families`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteFamilyAction",
      fallbackDetail: "Couldn't delete the family.",
    });
  }
}

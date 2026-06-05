"use server";

import { revalidatePath } from "next/cache";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { UnitDimension, UnitOfMeasurement } from "../types";
import {
  toErrorResult,
  unauthorizedResult,
  type ErrorResult,
} from "../errors/server";

export type UnitResult =
  | { ok: true; unit: UnitOfMeasurement }
  | ErrorResult;

export type DeleteResult = { ok: true } | ErrorResult;

interface UnitInput {
  name?: string;
  symbol?: string;
  dimension?: UnitDimension;
  factor_to_base?: string;
  is_base?: boolean;
  is_active?: boolean;
}

export async function createUnitAction(input: UnitInput): Promise<UnitResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("createUnitAction");

  try {
    const res = await api<{ unit: UnitOfMeasurement }>(
      `/api/units-of-measurement`,
      { method: "POST", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/settings/units-of-measurement`);
    return { ok: true, unit: res.unit };
  } catch (err) {
    return toErrorResult(err, {
      source: "createUnitAction",
      fallbackDetail: "Couldn't create the unit.",
    });
  }
}

export async function updateUnitAction(
  uuid: string,
  input: UnitInput,
): Promise<UnitResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("updateUnitAction");

  try {
    const res = await api<{ unit: UnitOfMeasurement }>(
      `/api/units-of-measurement/${uuid}`,
      { method: "PUT", token, body: JSON.stringify(input) },
    );
    revalidatePath(`/settings/units-of-measurement`);
    return { ok: true, unit: res.unit };
  } catch (err) {
    return toErrorResult(err, {
      source: "updateUnitAction",
      fallbackDetail: "Couldn't update the unit.",
    });
  }
}

export async function deleteUnitAction(uuid: string): Promise<DeleteResult> {
  const token = await getSessionToken();
  if (!token) return unauthorizedResult("deleteUnitAction");

  try {
    await api<void>(`/api/units-of-measurement/${uuid}`, {
      method: "DELETE",
      token,
    });
    revalidatePath(`/settings/units-of-measurement`);
    return { ok: true };
  } catch (err) {
    return toErrorResult(err, {
      source: "deleteUnitAction",
      fallbackDetail: "Couldn't delete the unit.",
    });
  }
}
